"use client"

import type React from "react"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
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
  const [show, setShow] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout>()

  const handleTouchStart = () => {
    timeoutRef.current = setTimeout(() => setShow(true), 500)
  }

  const handleTouchEnd = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setShow(false)
  }

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {children}
      </div>
      {show && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 bg-foreground/90 text-background text-xs rounded-md shadow-lg whitespace-nowrap z-50 pointer-events-none">
          {text}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 -mb-1 border-4 border-transparent border-b-foreground/90" />
        </div>
      )}
    </div>
  )
}

export default function SpeedReaderPage() {
  const [words, setWords] = useState<string[]>([])
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

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
      const wordArray = text.split(/\s+/).filter((word) => word.trim().length > 0)

      if (wordArray.length > 100000) {
        const proceed = confirm(
          `This file contains ${wordArray.length.toLocaleString()} words. Large files may affect performance. Continue?`,
        )
        if (!proceed) return
      }

      setWords(wordArray)
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
    setIsPlaying((prev) => !prev)
  }, [])

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
    setIsPlaying(false)
    setShowWordSelection(false)
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

  return (
    <div className={cn("min-h-screen flex flex-col", focusMode ? "bg-black" : "bg-background")}>
      {!focusMode && (
        <header className="px-4 py-3 flex items-center justify-between gap-2 border-b border-border/40">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="text-base md:text-lg font-semibold text-foreground/80">SpeedRead</div>
            {fileName && <div className="text-xs md:text-sm text-muted-foreground truncate">{fileName}</div>}
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
              <Tooltip text="Toggle Context View">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowMiniview(!showMiniview)}
                  className="h-9 w-9 text-muted-foreground hover:text-foreground"
                >
                  {showMiniview ? <SidebarClose className="h-4 w-4" /> : <SidebarOpen className="h-4 w-4" />}
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
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
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
                  <li>Supported formats: PDF, TXT, Markdown, MOBI, AZW3</li>
                  <li>Your reading progress is automatically saved</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-base mb-2">Reading Experience</h3>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Words are displayed one at a time in the center</li>
                  <li>The highlighted character (in color) is the optimal reading point</li>
                  <li>Focus on the highlighted character for faster comprehension</li>
                  <li>Your eyes stay still while words change, reducing eye strain</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-base mb-2">Keyboard Shortcuts</h3>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>
                    <strong>Space</strong> - Play/Pause
                  </li>
                  <li>
                    <strong>Left Arrow</strong> - Previous word
                  </li>
                  <li>
                    <strong>Right Arrow</strong> - Next word
                  </li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-base mb-2">Customization</h3>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Adjust reading speed (100-1000 WPM) with the slider</li>
                  <li>Change highlight color in Settings</li>
                  <li>Toggle between Light, Dark, and System theme in Settings</li>
                  <li>Use Context View to see surrounding words and jump to specific words</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-base mb-2">Tips for Speed Reading</h3>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Start at 250-300 WPM and gradually increase</li>
                  <li>Focus on comprehension, not just speed</li>
                  <li>Take breaks every 20-30 minutes</li>
                  <li>Practice regularly to build your reading speed</li>
                </ul>
              </section>
            </div>
          </Card>
        </div>
      )}

      {/* Word Selection Modal */}
      {showWordSelection && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowWordSelection(false)}
        >
          <Card
            className="w-full max-w-4xl p-4 md:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg md:text-xl font-bold">Jump to Word</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowWordSelection(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="text-xs md:text-sm text-muted-foreground mb-2">Click any word to jump to that position</div>

            <div className="flex flex-wrap gap-2 text-xs md:text-sm">
              {words.map((word, idx) => (
                <button
                  key={idx}
                  onClick={() => jumpToWord(idx)}
                  className={cn(
                    "px-2 py-1 rounded transition-colors text-foreground/70 hover:text-foreground hover:bg-muted",
                    idx === currentIndex && "bg-muted text-foreground font-semibold ring-2 ring-foreground/20",
                  )}
                >
                  {word}
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {showSettings && (
        <Card className="absolute top-14 right-4 z-50 w-72 md:w-80 p-4 space-y-4 shadow-lg">
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
                    "w-full aspect-square rounded-md border-2 transition-all hover:scale-110",
                    highlightColor === color.value
                      ? "border-foreground scale-110 ring-2 ring-foreground/30"
                      : "border-border",
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

      <div className="flex flex-1 overflow-hidden">
        {!focusMode && showMiniview && words.length > 0 && (
          <aside className="w-64 md:w-80 border-r border-border/40 overflow-y-auto p-3 md:p-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-xs md:text-sm text-foreground/80">Context View</h3>
              <span className="text-xs text-muted-foreground">
                {currentIndex + 1} / {words.length}
              </span>
            </div>

            <div className="text-xs text-muted-foreground mb-2">Tap any word to jump</div>

            <div className="flex flex-wrap gap-1.5 text-xs md:text-sm">
              {getContextWords().map((item) => (
                <button
                  key={item.index}
                  onClick={() => jumpToWord(item.index)}
                  className={cn(
                    "px-2 py-0.5 rounded transition-colors text-foreground/60 hover:text-foreground hover:bg-muted",
                    item.isCurrent && "bg-muted text-foreground font-semibold ring-2 ring-foreground/20",
                  )}
                >
                  {item.word}
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full mt-4 bg-transparent"
              onClick={() => setShowWordSelection(true)}
            >
              View All Words
            </Button>
          </aside>
        )}

        {/* Main Content */}
        <main className="flex-1 flex flex-col items-center justify-center px-4 relative">
          {words.length === 0 ? (
            <div
              className="w-full max-w-2xl border-2 border-dashed border-border/40 rounded-lg p-8 md:p-12 text-center space-y-4 transition-colors hover:border-border"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <Upload className="h-12 w-12 md:h-16 md:w-16 mx-auto text-muted-foreground" />
              <div>
                <h2 className="text-xl md:text-2xl font-semibold mb-2 text-foreground/80">Drop your file here</h2>
                <p className="text-sm md:text-base text-muted-foreground mb-4">
                  Supports PDF, TXT, Markdown, MOBI, AZW3
                </p>
                <Button onClick={() => fileInputRef.current?.click()} size="lg">
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
          ) : (
            <>
              <div
                className="text-center cursor-pointer w-full"
                onClick={() => !focusMode && setShowWordSelection(true)}
              >
                <div
                  className={cn(
                    "font-serif tracking-tight text-6xl sm:text-7xl md:text-8xl lg:text-9xl",
                    focusMode ? "text-foreground" : "text-foreground",
                  )}
                >
                  <span>{before}</span>
                  <span style={{ color: highlightColor }}>{highlight}</span>
                  <span>{after}</span>
                </div>
              </div>

              {focusMode && (
                <div className="absolute bottom-8 right-8 text-2xl md:text-3xl font-light text-muted-foreground">
                  {wpm} wpm
                </div>
              )}

              {!focusMode && (
                <div className="absolute bottom-4 left-4 right-4 space-y-2">
                  <div className="h-1 bg-muted/50 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-foreground/30 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {currentIndex + 1} / {words.length} words
                    </span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {!focusMode && words.length > 0 && (
        <footer className="border-t border-border/40 px-4 py-3 md:py-4">
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
