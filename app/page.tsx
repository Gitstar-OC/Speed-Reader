"use client"

import type React from "react"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
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
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs"

// Configure PDF.js worker
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`
}

const COLOR_OPTIONS = [
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
]

import { Switch } from "@/components/ui/switch"

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
  const [fullscreenOnPlay, setFullscreenOnPlay] = useState(false)
  const [showMiniview, setShowMiniview] = useState(false)
  const [showWordSelection, setShowWordSelection] = useState(false)
  const [viewMode, setViewMode] = useState<"reader" | "document">("reader")
  const [showMinimap, setShowMinimap] = useState(false)
  // Page-based PDF state
  const [pdfPages, setPdfPages] = useState<{ pageNum: number, text: string, wordStart: number, wordEnd: number }[]>([])
  const [currentPdfPage, setCurrentPdfPage] = useState(1)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const activeTokenRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLDivElement>(null)
  const minimapCurrentRef = useRef<HTMLSpanElement>(null)

  // Estimate page number (approx 250 words per page)
  const wordsPerPage = 250
  const currentPage = Math.floor(currentIndex / wordsPerPage) + 1
  const totalPages = Math.ceil(words.length / wordsPerPage)

  useEffect(() => {
    if (!isPlaying && activeTokenRef.current) {
      activeTokenRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [isPlaying, currentIndex])

  // Scroll minimap to current word
  useEffect(() => {
    if (minimapCurrentRef.current && minimapRef.current) {
      const container = minimapRef.current
      const element = minimapCurrentRef.current
      const containerHeight = container.clientHeight
      const elementTop = element.offsetTop
      container.scrollTop = elementTop - containerHeight / 2
    }
  }, [currentIndex])

  const [speedVisible, setSpeedVisible] = useState(false)

  // Load saved progress from localStorage
  useEffect(() => {
    const savedProgress = localStorage.getItem("speedreader-progress")
    const savedTheme = localStorage.getItem("speedreader-theme") as "light" | "dark" | "system" | null
    const savedFullscreen = localStorage.getItem("speedreader-fullscreen")
    const savedColor = localStorage.getItem("speedreader-color")

    if (savedProgress) {
      const { words: savedWords, index, fileName: savedFileName } = JSON.parse(savedProgress)
      setWords(savedWords)
      setCurrentIndex(index)
      setFileName(savedFileName)
    }

    if (savedTheme) {
      setTheme(savedTheme)
    }

    if (savedFullscreen) {
      setFullscreenOnPlay(savedFullscreen === "true")
    }

    if (savedColor) {
      setHighlightColor(savedColor)
    }
  }, [])

  // Save progress to localStorage (and settings)
  useEffect(() => {
    if (words.length > 0) {
      localStorage.setItem("speedreader-progress", JSON.stringify({
        words,
        index: currentIndex,
        fileName,
        lastRead: new Date().toISOString(),
        totalWords: words.length
      }))
    }
  }, [words, currentIndex, fileName])

  // Save Settings when changed
  useEffect(() => {
    localStorage.setItem("speedreader-fullscreen", String(fullscreenOnPlay))
  }, [fullscreenOnPlay])

  useEffect(() => {
    localStorage.setItem("speedreader-color", highlightColor)
  }, [highlightColor])

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

      const pages: { pageNum: number, text: string, wordStart: number, wordEnd: number }[] = []
      let fullText = ""
      let wordCount = 0

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        const pageText = textContent.items.map((item: any) => item.str).join(" ")
        const pageWords = pageText.split(/\s+/).filter(w => w.length > 0)

        pages.push({
          pageNum: i,
          text: pageText,
          wordStart: wordCount,
          wordEnd: wordCount + pageWords.length - 1
        })

        wordCount += pageWords.length
        fullText += pageText + " "

        // Allow browser to breathe every 5 pages
        if (i % 5 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }

      setPdfPages(pages)
      return fullText
    } else if (file.name.endsWith(".mobi") || file.name.endsWith(".azw3") || file.name.endsWith(".azw")) {
      const text = await file.text()
      setPdfPages([]) // Clear PDF pages for non-PDF files
      return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")
    } else {
      const text = await file.text()
      setPdfPages([]) // Clear PDF pages for non-PDF files
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
      // Reset PDF page to 1 when new file loaded
      setCurrentPdfPage(1)
    } catch (error) {
      console.error("Error parsing file:", error)
      alert("Error reading file. Please try a different file.")
      // Clear pdfPages on error
      setPdfPages([])
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
        if (containerRef.current && fullscreenOnPlay) {
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
  }, [fullscreenOnPlay])

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
      } else if (event.code === "ArrowUp") {
        event.preventDefault()
        setWpm(prev => Math.min(1000, prev + 50))
      } else if (event.code === "ArrowDown") {
        event.preventDefault()
        setWpm(prev => Math.max(100, prev - 50))
      } else if (event.code === "Escape") {
        if (isPlaying) {
          setIsPlaying(false)
        }
      } else if (event.code === "KeyD" && !event.metaKey && !event.ctrlKey) {
        // Toggle document view
        setViewMode(prev => prev === "document" ? "reader" : "document")
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [togglePlayPause, goBack, goForward, isPlaying])

  const currentWord = words[currentIndex] || ""
  const { before, highlight, after } = getHighlightedWord(currentWord)
  const progress = words.length > 0 ? (currentIndex / words.length) * 100 : 0

  // Calculate current PDF page based on word index
  const getCurrentPdfPage = useMemo(() => {
    if (pdfPages.length === 0) return 1
    const page = pdfPages.find(p => currentIndex >= p.wordStart && currentIndex <= p.wordEnd)
    return page?.pageNum || 1
  }, [currentIndex, pdfPages])

  // Update displayed PDF page when reading
  useEffect(() => {
    if (pdfPages.length > 0) {
      setCurrentPdfPage(getCurrentPdfPage)
    }
  }, [getCurrentPdfPage, pdfPages.length])

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

  // Scroll minimap to current word position
  const scrollMinimapToCurrent = useCallback(() => {
    if (minimapCurrentRef.current && minimapRef.current) {
      const container = minimapRef.current
      const element = minimapCurrentRef.current
      const containerHeight = container.clientHeight
      const elementTop = element.offsetTop
      container.scrollTop = elementTop - containerHeight / 2
    }
  }, [])

  // Memoized minimap words to prevent re-renders
  const minimapWords = useMemo(() => {
    // For very large documents, sample words to improve performance
    const maxWords = 5000
    const shouldSample = words.length > maxWords
    const sampleRate = shouldSample ? Math.ceil(words.length / maxWords) : 1

    return words.map((word, idx) => ({
      word,
      idx,
      show: !shouldSample || idx % sampleRate === 0 || idx === currentIndex
    })).filter(w => w.show)
  }, [words, currentIndex])

  // Reusable Minimap Component
  const renderMinimap = (isInDocView = false) => (
    <div
      className={cn(
        "bg-muted/5 border-l border-border/5 flex flex-col transition-colors relative group shrink-0",
        isInDocView ? "w-20" : "w-28"
      )}
      style={{ maxHeight: '100%', height: '100%' }}
    >
      {/* Go to current button */}
      <div className="px-1 py-1 border-b border-border/5 flex items-center justify-center">
        <button
          onClick={(e) => {
            e.stopPropagation();
            scrollMinimapToCurrent();
          }}
          className="text-[8px] px-2 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
        >
          Go to current
        </button>
      </div>

      {/* Scrollable Mini text representation - optimized */}
      <div
        ref={!isInDocView ? minimapRef : undefined}
        className="flex-1 overflow-y-auto overflow-x-hidden p-1.5 relative"
        style={{ maxHeight: 'calc(100% - 50px)' }}
      >
        <div className="text-[5px] leading-[7px] font-mono text-muted-foreground/40 select-none">
          {minimapWords.map(({ word, idx }) => {
            const isCurrent = idx === currentIndex
            return (
              <span
                key={idx}
                ref={isCurrent && !isInDocView ? minimapCurrentRef : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  jumpToWord(idx);
                  if (!isInDocView) {
                    setIsPlaying(true);
                  }
                }}
                className={cn(
                  "inline cursor-pointer hover:bg-primary/30 hover:text-primary rounded-sm px-px",
                  isCurrent ? "bg-primary text-primary-foreground font-bold" : ""
                )}
                style={{ pointerEvents: 'auto' }}
              >
                {word}{' '}
              </span>
            )
          })}
        </div>
      </div>
      {/* Page/Progress info */}
      <div className="text-[8px] text-center py-1 text-muted-foreground/50 border-t border-border/5 flex flex-col shrink-0">
        <span className="font-mono">{Math.round(progress)}%</span>
        <span className="opacity-60">pg {currentPage}/{totalPages}</span>
      </div>
    </div>
  )

  const renderReaderContent = () => (
    <div
      className={cn(
        "flex-1 flex w-full relative overflow-hidden",
        focusMode ? "bg-white dark:bg-black text-black dark:text-white" : ""
      )}
      style={{ height: '100%', maxHeight: '100%' }}
      onClick={() => {
        if (focusMode) {
          togglePlayPause();
        } else if (words.length > 0) {
          togglePlayPause();
        }
      }}
    >
      {/* Main Center Area - Absolutely positioned word display */}
      <div className="flex-1 relative" style={{ pointerEvents: 'none' }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="flex items-center justify-center w-full select-none cursor-pointer px-4"
            style={{ pointerEvents: 'auto' }}
          >
            <div
              className={cn(
                "flex items-baseline justify-center w-full font-serif tracking-tight leading-none",
                "text-5xl sm:text-6xl md:text-8xl lg:text-9xl",
                focusMode ? "" : "text-foreground"
              )}
            >
              <div className="flex-1 text-right whitespace-pre">{before}</div>
              <div
                className="flex-none text-center px-0.5"
                style={{ color: highlightColor, minWidth: '0.8ch' }}
              >
                {highlight}
              </div>
              <div className="flex-1 text-left whitespace-pre">{after}</div>
            </div>
          </div>
        </div>

        {/* Status info overlay - adjust for mobile speed control */}
        <div className="absolute bottom-4 left-4 text-[10px] text-muted-foreground/40 font-mono sm:block hidden" style={{ pointerEvents: 'none' }}>
          {!focusMode && words.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <span>pg {currentPage}/{totalPages}</span>
              <span>{wpm} wpm</span>
            </div>
          )}
          {focusMode && (
            <div className="flex flex-col gap-0.5">
              <span className="text-lg">{Math.round(progress)}%</span>
              <span>pg {currentPage}/{totalPages}</span>
            </div>
          )}
        </div>

        {/* Tap hint - adjust for mobile speed control */}
        {!focusMode && words.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-muted-foreground/30 sm:block hidden" style={{ pointerEvents: 'none' }}>
            Tap to {isPlaying ? 'pause' : 'play'}
          </div>
        )}

        {focusMode && (
          <div className="absolute bottom-4 right-4 text-xs text-muted-foreground/20 animate-pulse sm:block hidden" style={{ pointerEvents: 'none' }}>
            Tap anywhere to pause
          </div>
        )}

        {/* Mobile Speed Control - shown at bottom on small screens */}
        {!focusMode && words.length > 0 && (
          <div className="absolute bottom-4 left-4 sm:hidden" style={{ pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/80 backdrop-blur-md border border-border/10 shadow-lg">
              <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{wpm}</span>
              <Slider
                value={[wpm]}
                onValueChange={([value]) => setWpm(value)}
                min={100}
                max={1000}
                step={50}
                className="w-24"
              />
              <span className="text-[9px] text-muted-foreground">wpm</span>
            </div>
          </div>
        )}
      </div>

      {/* Always-visible Minimap on the right - use opacity for smooth transition - hidden on mobile */}
      {words.length > 0 && (
        <div
          className={cn(
            "h-full shrink-0 transition-opacity duration-200 hidden sm:block",
            focusMode ? "opacity-0 pointer-events-none" : "opacity-100"
          )}
          style={{ pointerEvents: focusMode ? 'none' : 'auto' }}
          onClick={(e) => e.stopPropagation()}
        >
          {renderMinimap(false)}
        </div>
      )}
    </div>
  )

  const renderDocumentView = () => {
    // Get words for the current page if we have PDF pages
    const getPageWords = (pageNum: number) => {
      if (pdfPages.length === 0) return null
      const page = pdfPages.find(p => p.pageNum === pageNum)
      if (!page) return null
      return {
        words: words.slice(page.wordStart, page.wordEnd + 1),
        startIndex: page.wordStart
      }
    }

    const pageData = pdfPages.length > 0 ? getPageWords(currentPdfPage) : null

    return (
      <div className="flex-1 flex h-full bg-background relative overflow-hidden">
        {/* Main Document Content */}
        <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
          {/* Header for Document View */}
          <div className="shrink-0 px-2 py-1.5 border-b border-border/10 bg-background/95 backdrop-blur flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => setViewMode("reader")}>
              <ChevronLeft className="h-3 w-3" />
              <span className="text-[10px]">Back</span>
            </Button>

            {/* Page Navigation for PDFs */}
            {pdfPages.length > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={currentPdfPage <= 1}
                  onClick={() => setCurrentPdfPage(p => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <span className="text-[10px] font-mono text-muted-foreground min-w-[60px] text-center">
                  Page {currentPdfPage} / {pdfPages.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={currentPdfPage >= pdfPages.length}
                  onClick={() => setCurrentPdfPage(p => Math.min(pdfPages.length, p + 1))}
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground font-mono">
                Word {currentIndex + 1}/{words.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[9px]"
                onClick={() => {
                  if (pdfPages.length > 0) {
                    setCurrentPdfPage(getCurrentPdfPage)
                  }
                  setTimeout(() => {
                    activeTokenRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }, 100)
                }}
              >
                Go to current
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-4">
            {/* Page-based rendering for PDFs */}
            {pdfPages.length > 0 && pageData ? (
              <div className="max-w-3xl mx-auto">
                {/* Page card like Google Drive */}
                <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-border/20 p-6 md:p-8 min-h-[60vh]">
                  <div className="font-serif text-sm md:text-base leading-relaxed text-foreground/90 tracking-wide selection:bg-primary/20">
                    {pageData.words.map((word, idx) => {
                      const globalIdx = pageData.startIndex + idx
                      const isCurrent = globalIdx === currentIndex
                      return (
                        <span
                          key={globalIdx}
                          ref={isCurrent ? activeTokenRef : null}
                          onClick={() => jumpToWord(globalIdx)}
                          className={cn(
                            "cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors duration-75 rounded-sm",
                            isCurrent ? "bg-yellow-200/80 dark:bg-yellow-500/50 text-foreground ring-2 ring-yellow-500/50 px-0.5 font-medium" : ""
                          )}
                        >
                          {word}{' '}
                        </span>
                      )
                    })}
                  </div>
                </div>
                {/* Page number indicator */}
                <div className="text-center text-xs text-muted-foreground mt-4">
                  Page {currentPdfPage} of {pdfPages.length}
                </div>
              </div>
            ) : (
              /* Regular text rendering for non-PDFs */
              <div className="max-w-3xl mx-auto font-serif text-sm md:text-base leading-relaxed text-foreground/80 tracking-wide selection:bg-primary/20">
                <p className="text-[9px] text-muted-foreground mb-4 italic">Click any word to select it, then go back to reader and tap to play.</p>
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
                        }
                      }}
                      className={cn(
                        "transition-colors duration-75 rounded-sm",
                        isWord ? "cursor-pointer hover:bg-primary/10 hover:text-primary" : "",
                        isCurrent ? "bg-yellow-200/80 dark:bg-yellow-500/50 text-foreground ring-2 ring-yellow-500/50 px-0.5 font-medium" : ""
                      )}
                    >
                      {token}
                    </span>
                  )
                }) : (
                  <p className="whitespace-pre-wrap">{words.join(' ')}</p>
                )}
                <div className="h-[20vh]" />
              </div>
            )}
          </div>
        </div>

        {/* Minimap in Document View - hidden on mobile */}
        {words.length > 0 && (
          <div className="h-full shrink-0 hidden sm:block">
            {renderMinimap(true)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "min-h-screen flex flex-col bg-background transition-colors duration-300",
        // If in focus mode, force the background
        focusMode ? "bg-white dark:bg-black" : ""
      )}
    >
      {/* Header - use opacity for smooth transition instead of hiding */}
      {viewMode === "reader" && (
        <header
          className={cn(
            "px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2 border-b border-border/10 shrink-0 transition-opacity duration-200",
            focusMode ? "opacity-0 pointer-events-none absolute top-0 left-0 right-0 z-10" : "opacity-100"
          )}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {fileName && (
              <div className="text-xs sm:text-sm text-muted-foreground truncate max-w-[120px] sm:max-w-[150px] md:truncate-none md:max-w-none">
                {fileName}
              </div>
            )}
          </div>


          {/* WPM Speed Control in Navbar - hidden on mobile, shown at bottom instead */}
          {words.length > 0 && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-muted/30 border border-border/10">
              <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{wpm}</span>
              <Slider
                value={[wpm]}
                onValueChange={([value]) => setWpm(value)}
                min={100}
                max={1000}
                step={50}
                className="w-20"
              />
              <span className="text-[9px] text-muted-foreground">wpm</span>
            </div>
          )}

          <div className="flex items-center gap-1">
            <Tooltip text="Help & Guide">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowGuide(!showGuide)}
                className="h-8 w-8 sm:h-9 sm:w-9 text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="h-3 w-3 sm:h-4 sm:w-4" />
              </Button>
            </Tooltip>
            {words.length > 0 && (
              <Tooltip text="Document View">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setViewMode("document")}
                  className="h-8 w-8 sm:h-9 sm:w-9 text-muted-foreground hover:text-foreground"
                >
                  <SidebarOpen className="h-3 w-3 sm:h-4 sm:w-4" />
                </Button>
              </Tooltip>
            )}
            <Tooltip text="Settings">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSettings(!showSettings)}
                className="h-8 w-8 sm:h-9 sm:w-9 text-muted-foreground hover:text-foreground"
              >
                <Settings className="h-3 w-3 sm:h-4 sm:w-4" />
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
        <Card className="absolute top-14 right-4 z-50 w-72 md:w-80 p-4 shadow-lg border-none ring-1 ring-border/10">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Settings</h3>
            <Button variant="ghost" size="icon" onClick={() => setShowSettings(false)} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Fullscreen on Play</Label>
              <Switch
                checked={fullscreenOnPlay}
                onCheckedChange={setFullscreenOnPlay}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Automatically enter fullscreen mode when reading starts.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Highlight Color</Label>
            <div className="grid grid-cols-7 gap-2">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color.value}
                  className={cn(
                    "w-full aspect-square h-8 rounded-md transition-all hover:scale-110 ring-1 ring-border",
                    highlightColor === color.value
                      ? "ring-2 ring-foreground scale-110"
                      : "opacity-70",
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


      {/* Horizontal Progress Bar - Visible when NOT focus mode */}
      {!focusMode && words.length > 0 && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-muted/20 z-10 w-full">
          <div
            className="h-full bg-primary/70 dark:bg-primary/90 transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Main Content Area */}
      {viewMode === "document" && !focusMode ? (
        renderDocumentView()
      ) : (
        <main className="flex-1 flex flex-col relative overflow-hidden" style={{ height: 'calc(100vh - 64px)', maxHeight: 'calc(100vh - 64px)' }}>
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
      {/* REMOVED: Footer is now integrated into the main Reader view as per request */}
    </div>
  )
}
