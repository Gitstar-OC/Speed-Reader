"use client"

import type React from "react"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Tooltip as TooltipRoot,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Play,
  Pause,
  SkipBack,
  Upload,
  Moon,
  Sun,
  Settings,
  X,
  HelpCircle,
  Monitor,
  SidebarClose,
  SidebarOpen,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import * as pdfjsLib from "pdfjs-dist"

// Configure PDF.js worker
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
}

const COLOR_OPTIONS = [
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
]

function Tooltip({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <TooltipRoot delayDuration={300}>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {text}
      </TooltipContent>
    </TooltipRoot>
  )
}

export default function SpeedReaderPage() {
  const [words, setWords] = useState<string[]>([])
  const [tokens, setTokens] = useState<string[]>([])
  const [wordTokenIndices, setWordTokenIndices] = useState<number[]>([])
  const [tokenToWordIndex, setTokenToWordIndex] = useState<number[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [wpm, setWpm] = useState(300)
  const [highlightColor, setHighlightColor] = useState("#ef4444")
  const [fileName, setFileName] = useState("")
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system")
  const [showSettings, setShowSettings] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [showMiniview, setShowMiniview] = useState(false)
  const [showWordSelection, setShowWordSelection] = useState(false)
  const [viewMode, setViewMode] = useState<"reader" | "document">("reader")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const activeTokenRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isPlaying && activeTokenRef.current) {
      activeTokenRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [isPlaying, currentIndex])
  const [speedVisible, setSpeedVisible] = useState(false)

  // Load saved progress from localStorage
  useEffect(() => {
    const savedProgress = localStorage.getItem("speedreader-progress")
    const savedTheme = localStorage.getItem("speedreader-theme") as "light" | "dark" | "system" | null

    if (savedProgress) {
      const { words: savedWords, index, fileName: savedFileName } = JSON.parse(savedProgress)
      setWords(savedWords)
      setCurrentIndex(index)
      setFileName(savedFileName)
    }

    if (savedTheme) {
      setTheme(savedTheme)
    }
  }, [])

  // Save progress to localStorage
  useEffect(() => {
    if (words.length > 0) {
      localStorage.setItem("speedreader-progress", JSON.stringify({ words, index: currentIndex, fileName }))
    }
  }, [words, currentIndex, fileName])

  useEffect(() => {
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
      const applySystemTheme = () => {
        document.documentElement.classList.toggle("dark", mediaQuery.matches)
      }
      applySystemTheme()
      mediaQuery.addEventListener("change", applySystemTheme)
      localStorage.setItem("speedreader-theme", "system")
      return () => mediaQuery.removeEventListener("change", applySystemTheme)
    } else {
      document.documentElement.classList.toggle("dark", theme === "dark")
      localStorage.setItem("speedreader-theme", theme)
    }
  }, [theme])

  // Calculate the optimal reading position (ORP) - typically around 30-40% into the word
  const getHighlightedWord = (word: string) => {
    if (word.length === 1) return { before: "", highlight: word, after: "" }

    const orp = Math.floor(word.length * 0.35)
    return {
      before: word.slice(0, orp),
      highlight: word[orp],
      after: word.slice(orp + 1),
    }
  }

  const parseFile = async (file: File) => {
    const fileType = file.type || file.name.split(".").pop()?.toLowerCase()

    if (fileType === "application/pdf" || file.name.endsWith(".pdf")) {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

      const chunkSize = 10 // Process 10 pages at a time
      let fullText = ""

      for (let i = 1; i <= pdf.numPages; i += chunkSize) {
        const endPage = Math.min(i + chunkSize - 1, pdf.numPages)
        for (let j = i; j <= endPage; j++) {
          const page = await pdf.getPage(j)
          const textContent = await page.getTextContent()
          const pageText = textContent.items.map((item: any) => item.str).join(" ")
          fullText += pageText + " "
        }
        // Allow browser to breathe
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      return fullText
    } else if (file.name.endsWith(".mobi") || file.name.endsWith(".azw3") || file.name.endsWith(".azw")) {
      const text = await file.text()
      return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")
    } else {
      const text = await file.text()
      return text
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await parseFile(file)
      const rawTokens = text.split(/(\s+)/)
      const validWordIndices: number[] = []
      const cleanWords: string[] = []
      const tokenToWordIdx = new Array(rawTokens.length).fill(-1)

      rawTokens.forEach((token, index) => {
        if (token.trim().length > 0) {
          cleanWords.push(token)
          validWordIndices.push(index)
          tokenToWordIdx[index] = cleanWords.length - 1
        }
      })

      if (cleanWords.length > 100000) {
        const proceed = confirm(
          `This file contains ${cleanWords.length.toLocaleString()} words. Large files may affect performance. Continue?`,
        )
        if (!proceed) return
      }

      setWords(cleanWords)
      setTokens(rawTokens)
      setWordTokenIndices(validWordIndices)
      setTokenToWordIndex(tokenToWordIdx)
      setCurrentIndex(0)
      setFileName(file.name)
      setIsPlaying(false)
    } catch (error) {
      console.error("Error parsing file:", error)
      alert("Error reading file. Please try a different file.")
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) {
      const input = fileInputRef.current
      if (input) {
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        input.files = dataTransfer.files
        handleFileUpload({ target: input } as any)
      }
    }
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  // Playback controls
  const togglePlayPause = useCallback(() => {
    setIsPlaying((prev) => {
      const nextState = !prev
      if (nextState) {
        // Entering Play Mode
        if (containerRef.current) {
             const element = containerRef.current;
             // Try to enter fullscreen on mobile or generally
             if (element.requestFullscreen) {
                element.requestFullscreen().catch((err) => {
                     console.log("Fullscreen request failed", err)
                })
             }
        }
      } else {
         // Exiting Play Mode
         if (document.fullscreenElement) {
             document.exitFullscreen().catch((err) => {
                console.log("Exit fullscreen failed", err)
             })
         }
      }
      return nextState
    })
  }, [])
  
  // Handle fullscreen change events to sync state if user exits via ESC
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isPlaying) {
          setIsPlaying(false)
      }
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange)
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange)
  }, [isPlaying])

  const goBack = useCallback(() => {
    setCurrentIndex((prev) => Math.max(0, prev - 1))
  }, [])

  const goForward = useCallback(() => {
    setCurrentIndex((prev) => Math.min(words.length - 1, prev + 1))
  }, [words.length])

  const resetReading = useCallback(() => {
    setCurrentIndex(0)
    setIsPlaying(false)
  }, [])

  const jumpToWord = useCallback((index: number) => {
    setCurrentIndex(index)
    // setIsPlaying(false) // Don't stop playing if we just jump
    // setShowWordSelection(false)
  }, [])

  // Handle playback timer
  useEffect(() => {
    if (isPlaying && currentIndex < words.length - 1) {
      const interval = 60000 / wpm // Convert WPM to milliseconds per word
      timerRef.current = setTimeout(() => {
        setCurrentIndex((prev) => {
          if (prev >= words.length - 1) {
            setIsPlaying(false)
            return prev
          }
          return prev + 1
        })
      }, interval)
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [isPlaying, currentIndex, words.length, wpm])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault()
        togglePlayPause()
      } else if (event.code === "ArrowLeft") {
        event.preventDefault()
        goBack()
      } else if (event.code === "ArrowRight") {
        event.preventDefault()
        goForward()
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [togglePlayPause, goBack, goForward])

  const currentWord = words[currentIndex] || ""
  const { before, highlight, after } = getHighlightedWord(currentWord)
  const progress = words.length > 0 ? (currentIndex / words.length) * 100 : 0

  const getContextWords = () => {
    const contextSize = 50
    const start = Math.max(0, currentIndex - contextSize)
    const end = Math.min(words.length, currentIndex + contextSize)
    return words.slice(start, end).map((word, idx) => ({
      word,
      index: start + idx,
      isCurrent: start + idx === currentIndex,
    }))
  }

  const focusMode = isPlaying && words.length > 0

  useEffect(() => {
    setSpeedVisible(focusMode)
  }, [focusMode])

  
  // -- RENDER HELPERS -- //
  
  const renderReaderContent = () => (
    <div 
        className={cn(
            "flex-1 flex flex-col items-center justify-center relative transition-colors duration-300",
             // Focus Mode Styles (Fullscreen Overlay effect handled by parent container z-index or fullscreen API)
             focusMode ? "bg-white dark:bg-black text-black dark:text-white" : ""
        )}
    >
        {/* Main Word Display */}
        <div
            className="text-center cursor-pointer w-full select-none"
            onClick={() => !focusMode && setViewMode("document")}
        >
            <div
                className={cn(
                    "font-serif tracking-tight",
                    "text-6xl sm:text-7xl md:text-8xl lg:text-9xl", // Big font
                    focusMode ? "" : "text-foreground"
                )}
            >
                <span>{before}</span>
                <span style={{ color: focusMode ? highlightColor : highlightColor }}>{highlight}</span>
                <span>{after}</span>
            </div>
            
             {/* Hint when idle */}
            {!focusMode && (
                <div className="mt-8 text-sm text-muted-foreground animate-pulse">
                    Tap word for context
                </div>
            )}
        </div>
        
        {/* Speed Indicator in Focus Mode */}
        {focusMode && (
             <div className="absolute bottom-10 left-0 right-0 text-center">
                 <div className="text-xl md:text-2xl font-light opacity-50">
                    {wpm} wpm
                 </div>
             </div>
        )}
    </div>
  )

  const renderDocumentView = () => (
      <div className="flex-1 flex flex-col h-full bg-background relative">
          {/* Header for Document View */}
          <div className="sticky top-0 z-10 px-4 py-3 border-b border-border/10 bg-background/95 backdrop-blur flex items-center justify-between">
              <Button variant="ghost" className="gap-2" onClick={() => setViewMode("reader")}>
                  <ChevronLeft className="h-4 w-4" />
                  Back to Reader
              </Button>
               <span className="text-xs text-muted-foreground">
                   {currentIndex + 1} / {words.length} ({Math.round(progress)}%)
               </span>
          </div>
          
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-12 md:py-12">
              <div className="max-w-3xl mx-auto font-serif text-lg md:text-xl leading-loose text-foreground/80 tracking-wide selection:bg-primary/20">
                 {tokens.length > 0 ? tokens.map((token, index) => {
                     const wordIdx = tokenToWordIndex[index]
                     const isWord = wordIdx !== -1
                     const isCurrent = isWord && wordIdx === currentIndex
                     
                     return (
                         <span
                            key={index}
                            ref={isCurrent ? activeTokenRef : null}
                            onClick={() => {
                                if (isWord) {
                                  jumpToWord(wordIdx);
                                  // Optional: Auto switch back to reader? 
                                  // setViewMode("reader");
                                }
                            }}
                            className={cn(
                                "transition-colors duration-200 rounded",
                                isWord ? "cursor-pointer hover:bg-muted/50" : "",
                                isCurrent ? "bg-yellow-200/50 dark:bg-yellow-900/50 text-foreground font-medium ring-2 ring-yellow-500/20 px-0.5 mx-[-2px]" : ""
                            )}
                         >
                            {token}
                         </span>
                     )
                 }) : (
                     <p className="whitespace-pre-wrap">{words.join(' ')}</p>
                 )}
                 <div className="h-[50vh]" />
              </div>
          </div>
      </div>
  )

  return (
    <div 
        ref={containerRef}
        className={cn(
            "min-h-screen flex flex-col bg-background transition-colors duration-300",
            // If in focus mode, force the background
            focusMode ? "bg-white dark:bg-black" : ""
        )}
    >
      {/* Header - Hidden in Focus Mode */}
      {!focusMode && viewMode === "reader" && (
        <header className="px-4 py-3 flex items-center justify-between gap-2 border-b border-border/10 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="text-base font-bold tracking-tight">SpeedRead</div>
            {fileName && <div className="text-sm text-muted-foreground truncate">{fileName}</div>}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip text="Help & Guide">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowGuide(!showGuide)}
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </Tooltip>
            {words.length > 0 && (
                <Tooltip text="Document View">
                    <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => setViewMode("document")}
                        className="h-9 w-9 text-muted-foreground hover:text-foreground"
                    >
                         <SidebarOpen className="h-4 w-4" />
                    </Button>
                </Tooltip>
            )}
            <Tooltip text="Settings">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSettings(!showSettings)}
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
        </header>
      )}

      {/* Guide Modal */}
      {showGuide && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 text-foreground/90"
          onClick={() => setShowGuide(false)}
        >
          <Card
            className="w-full max-w-2xl p-4 md:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl md:text-2xl font-bold">How to Use SpeedRead</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowGuide(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4 text-sm">
              <section>
                <h3 className="font-semibold text-base mb-2">Getting Started</h3>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Drag and drop any file or click "Choose File" to upload</li>
                </ul>
              </section>
              <section>
                 <h3 className="font-semibold text-base mb-2">Modes</h3>
                 <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                     <li><strong>Reader Mode:</strong> Shows one word at a time. Click the word to see the full document.</li>
                     <li><strong>Focus Mode:</strong> Plays in fullscreen (Play button). distraction free.</li>
                     <li><strong>Document View:</strong> Read the full text and context.</li>
                 </ul>
              </section>
            </div>
          </Card>
        </div>
      )}

      {showSettings && !focusMode && (
        <Card className="absolute top-14 right-4 z-50 w-72 md:w-80 p-4 space-y-4 shadow-lg border-none ring-1 ring-border/10">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Settings</h3>
            <Button variant="ghost" size="icon" onClick={() => setShowSettings(false)} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Highlight Color</Label>
            <div className="grid grid-cols-6 gap-2">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color.value}
                  className={cn(
                    "w-full aspect-square rounded-md transition-all hover:scale-110 ring-1 ring-border",
                    highlightColor === color.value
                      ? "ring-2 ring-foreground scale-110"
                      : "opacity-80",
                  )}
                  style={{ backgroundColor: color.value }}
                  onClick={() => setHighlightColor(color.value)}
                  aria-label={color.name}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Theme</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={theme === "light" ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme("light")}
                className="flex-1"
              >
                <Sun className="h-4 w-4 mr-2" />
                Light
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme("dark")}
                className="flex-1"
              >
                <Moon className="h-4 w-4 mr-2" />
                Dark
              </Button>
              <Button
                variant={theme === "system" ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme("system")}
                className="flex-1"
              >
                <Monitor className="h-4 w-4 mr-2" />
                Auto
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Main Content Area */}
      {viewMode === "document" && !focusMode ? (
         renderDocumentView()
      ) : (
         <main className="flex-1 flex flex-col relative h-[calc(100vh-theme(spacing.16))]">
            {words.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <div
                  className="w-full max-w-2xl border-2 border-dashed border-border/20 rounded-xl p-12 text-center space-y-6 transition-colors hover:border-border/50 hover:bg-muted/50"
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                >
                  <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
                    <Upload className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold mb-2">Drop your file here</h2>
                    <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                      Supports PDF, TXT, Markdown, MOBI, AZW3. content is processed locally in your browser.
                    </p>
                    <Button onClick={() => fileInputRef.current?.click()} size="lg" className="rounded-full px-8">
                      Choose File
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt,.md,.markdown,.mobi,.azw,.azw3"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>
                </div>
              </div>
            ) : (
                renderReaderContent()
            )}
         </main>
      )}
      
      {/* Footer Controls - Visible when NOT in Focus Mode and NOT in Document view (or maybe document view too?) */}
      {/* User requirement: "normal one stopped with all those modifiers... next is play mode... nothing but the word" */}
      {!focusMode && viewMode === "reader" && words.length > 0 && (
        <footer className="border-t border-border/10 px-4 py-3 md:py-4 shrink-0">
          <div className="max-w-4xl mx-auto space-y-3 md:space-y-4">
            {/* Playback Controls */}
            <div className="flex items-center justify-center gap-2">
              <Tooltip text="Reset to start">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={resetReading}
                  className="h-9 w-9 md:h-10 md:w-10 text-muted-foreground hover:text-foreground"
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
              </Tooltip>
              <Tooltip text="Previous word (Left Arrow)">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={goBack}
                  className="h-9 w-9 md:h-10 md:w-10 text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </Tooltip>
              <Tooltip text="Play/Pause (Space)">
                <Button
                  variant={isPlaying ? "secondary" : "default"}
                  size="icon"
                  onClick={togglePlayPause}
                  className="h-11 w-11 md:h-12 md:w-12 shadow-none text-foreground bg-background"
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                </Button>
              </Tooltip>
              <Tooltip text="Next word (Right Arrow)">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={goForward}
                  className="h-9 w-9 md:h-10 md:w-10 text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Tooltip>
              <Tooltip text="Upload new file">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-9 w-9 md:h-10 md:w-10 text-muted-foreground hover:text-foreground"
                >
                  <Upload className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>

            {/* Speed Control */}
            <div className="flex items-center gap-3 md:gap-4">
              <Label className="text-xs md:text-sm whitespace-nowrap text-muted-foreground">Speed: {wpm} WPM</Label>
              <Slider
                value={[wpm]}
                onValueChange={([value]) => setWpm(value)}
                min={100}
                max={1000}
                step={50}
                className="flex-1"
              />
            </div>

            {/* Keyboard Shortcuts Hint */}
            <div className="text-center text-xs text-muted-foreground/70 hidden sm:block">
              Space: Play/Pause • Arrow Keys: Navigate • Tap word to jump
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
