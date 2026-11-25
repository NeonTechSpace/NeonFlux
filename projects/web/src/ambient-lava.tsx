import { useCallback, useEffect, useRef, useState } from "react"

const MOTION_STORAGE_KEY = "nf.motion"
const STATIC_PHASE_SECONDS = 22.0

interface BlobSpec {
    baseX: number
    baseY: number
    ampX: number
    ampY: number
    freqX: number
    freqY: number
    phaseX: number
    phaseY: number
    radius: number
    color: readonly [number, number, number]
}

// Seven distinct lava-lamp metaballs that drift across the viewport, pinch into liquid bridges, and separate cleanly
const BLOBS: readonly BlobSpec[] = [
    {
        baseX: -0.52,
        baseY: -0.14,
        ampX: 0.26,
        ampY: 0.24,
        freqX: 0.092,
        freqY: 0.068,
        phaseX: 0.3,
        phaseY: 1.4,
        radius: 0.145,
        color: [0.14, 0.44, 0.94],
    },
    {
        baseX: -0.2,
        baseY: 0.24,
        ampX: 0.28,
        ampY: 0.22,
        freqX: 0.074,
        freqY: 0.098,
        phaseX: 2.2,
        phaseY: 0.5,
        radius: 0.135,
        color: [0.16, 0.6, 0.96],
    },
    {
        baseX: -0.36,
        baseY: -0.32,
        ampX: 0.24,
        ampY: 0.2,
        freqX: 0.105,
        freqY: 0.078,
        phaseX: 4.1,
        phaseY: 2.9,
        radius: 0.11,
        color: [0.22, 0.78, 0.98],
    },
    {
        baseX: 0.08,
        baseY: -0.06,
        ampX: 0.3,
        ampY: 0.25,
        freqX: 0.069,
        freqY: 0.091,
        phaseX: 1.1,
        phaseY: 3.7,
        radius: 0.14,
        color: [0.42, 0.28, 0.9],
    },
    {
        baseX: 0.48,
        baseY: 0.18,
        ampX: 0.26,
        ampY: 0.24,
        freqX: 0.082,
        freqY: 0.066,
        phaseX: 3.4,
        phaseY: 1.7,
        radius: 0.15,
        color: [0.58, 0.22, 0.86],
    },
    {
        baseX: 0.38,
        baseY: -0.26,
        ampX: 0.24,
        ampY: 0.22,
        freqX: 0.096,
        freqY: 0.074,
        phaseX: 5.2,
        phaseY: 4.4,
        radius: 0.125,
        color: [0.74, 0.24, 0.78],
    },
    {
        baseX: 0.16,
        baseY: 0.3,
        ampX: 0.32,
        ampY: 0.19,
        freqX: 0.064,
        freqY: 0.086,
        phaseX: 2.7,
        phaseY: 5.1,
        radius: 0.115,
        color: [0.34, 0.4, 0.92],
    },
]

const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec2 u_res;
uniform vec4 u_blobs[7];
uniform vec3 u_colors[7];

void main() {
    float aspect = u_res.x / max(u_res.y, 1.0);
    vec2 p = vec2((gl_FragCoord.x / u_res.x - 0.5) * aspect, gl_FragCoord.y / u_res.y - 0.5);
    float field = 0.0;
    vec3 weighted = vec3(0.0);
    for (int i = 0; i < 7; i++) {
        vec2 d = p - u_blobs[i].xy;
        float contrib = u_blobs[i].z / (dot(d, d) + 0.0022);
        field += contrib;
        weighted += u_colors[i] * contrib;
    }
    vec3 col = weighted / max(field, 0.0001);
    float halo = smoothstep(0.32, 1.05, field) * 0.11;
    float body = smoothstep(0.84, 1.32, field);
    float core = 0.76 + 0.24 * exp(-max(field - 1.05, 0.0) * 0.55);
    float sheen = exp(-pow((field - 1.06) * 2.8, 2.0)) * 0.06;
    float alpha = clamp(halo + body * (0.26 * core) + sheen, 0.0, 0.46);
    gl_FragColor = vec4(col * alpha, alpha);
}
`

function readStoredMotion(): "on" | "off" | null {
    try {
        if (typeof window === "undefined") return null
        const raw = window.localStorage.getItem(MOTION_STORAGE_KEY)
        return raw === "on" || raw === "off" ? raw : null
    } catch {
        return null
    }
}

function systemPrefersReducedMotion(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function readInitialMotion(): boolean {
    const stored = readStoredMotion()
    if (stored) return stored === "on"
    return !systemPrefersReducedMotion()
}

function applyDocumentMotion(enabled: boolean): void {
    if (typeof document === "undefined") return
    document.documentElement.toggleAttribute("data-still", !enabled)
    document.documentElement.dataset.motion = enabled ? "on" : "off"
}

/** Shared motion preference matching the public site's nf.motion key and data-still attribute.
 *  Initializes to true so SSR and initial client hydration match, then syncs stored/system preference on mount */
export function useMotionPreference() {
    const [enabled, setEnabled] = useState(true)
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        const initial = readInitialMotion()
        applyDocumentMotion(initial)
        setEnabled(initial)
        setHydrated(true)
    }, [])

    useEffect(() => {
        if (!hydrated) return
        applyDocumentMotion(enabled)
    }, [enabled, hydrated])

    useEffect(() => {
        if (typeof window === "undefined") return
        const onStorage = (event: StorageEvent) => {
            if (event.key !== MOTION_STORAGE_KEY) return
            if (event.newValue === "on") setEnabled(true)
            else if (event.newValue === "off") setEnabled(false)
            else setEnabled(!systemPrefersReducedMotion())
        }
        window.addEventListener("storage", onStorage)
        const query =
            typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null
        const onMedia = () => {
            if (readStoredMotion() === null) setEnabled(!query?.matches)
        }
        query?.addEventListener("change", onMedia)
        return () => {
            window.removeEventListener("storage", onStorage)
            query?.removeEventListener("change", onMedia)
        }
    }, [])

    const toggle = useCallback(() => {
        setEnabled((current) => {
            const next = !current
            try {
                window.localStorage.setItem(MOTION_STORAGE_KEY, next ? "on" : "off")
            } catch {}
            return next
        })
    }, [])

    return { enabled, toggle }
}

/** Header switch controlling dashboard ambient lava blobs and UI motion */
export function MotionToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            className="motion-toggle"
            role="switch"
            aria-checked={enabled}
            aria-label="Animations"
            onClick={onToggle}
        >
            <span className="motion-track" aria-hidden="true" />
            <span className="motion-label">Animations</span>
        </button>
    )
}

function blobCoords(seconds: number, aspect: number, out: Float32Array) {
    const spreadX = Math.max(0.76, Math.min(aspect * 0.68, 1.25))
    for (let index = 0; index < BLOBS.length; index++) {
        const blob = BLOBS[index]!
        const x = (blob.baseX + Math.sin(seconds * blob.freqX + blob.phaseX) * blob.ampX) * spreadX
        const y = blob.baseY + Math.cos(seconds * blob.freqY + blob.phaseY) * blob.ampY
        const base = index * 4
        out[base] = x
        out[base + 1] = y
        out[base + 2] = blob.radius * blob.radius
        out[base + 3] = 0
    }
}

interface Renderer {
    resize: (width: number, height: number) => void
    draw: (seconds: number) => void
    dispose: () => void
}

function createWebGLRenderer(canvas: HTMLCanvasElement): Renderer | null {
    let gl: WebGLRenderingContext | null = null
    try {
        gl = canvas.getContext("webgl", {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: "low-power",
            preserveDrawingBuffer: false,
        })
    } catch {
        return null
    }
    if (!gl) return null

    const compile = (type: number, source: string) => {
        const shader = gl!.createShader(type)
        if (!shader) return null
        gl!.shaderSource(shader, source)
        gl!.compileShader(shader)
        if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
            gl!.deleteShader(shader)
            return null
        }
        return shader
    }

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    if (!vs || !fs) {
        if (vs) gl.deleteShader(vs)
        if (fs) gl.deleteShader(fs)
        return null
    }

    const program = gl.createProgram()
    if (!program) {
        gl.deleteShader(vs)
        gl.deleteShader(fs)
        return null
    }
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program)
        gl.deleteShader(vs)
        gl.deleteShader(fs)
        return null
    }

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    const posLoc = gl.getAttribLocation(program, "a_pos")
    const resLoc = gl.getUniformLocation(program, "u_res")
    const blobsLoc = gl.getUniformLocation(program, "u_blobs")
    const colorsLoc = gl.getUniformLocation(program, "u_colors")

    gl.useProgram(program)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
    const colorData = new Float32Array(BLOBS.flatMap((blob) => blob.color))
    gl.uniform3fv(colorsLoc, colorData)

    const blobData = new Float32Array(BLOBS.length * 4)
    let renderWidth = 1
    let renderHeight = 1

    return {
        resize(width, height) {
            const scale = Math.min(0.55, 720 / Math.max(width, 1))
            renderWidth = Math.max(1, Math.round(width * scale))
            renderHeight = Math.max(1, Math.round(height * scale))
            canvas.width = renderWidth
            canvas.height = renderHeight
            gl!.viewport(0, 0, renderWidth, renderHeight)
        },
        draw(seconds) {
            const aspect = renderWidth / Math.max(renderHeight, 1)
            blobCoords(seconds, aspect, blobData)
            gl!.useProgram(program)
            gl!.uniform2f(resLoc, renderWidth, renderHeight)
            gl!.uniform4fv(blobsLoc, blobData)
            gl!.clearColor(0, 0, 0, 0)
            gl!.clear(gl!.COLOR_BUFFER_BIT)
            gl!.drawArrays(gl!.TRIANGLES, 0, 3)
        },
        dispose() {
            if (buffer) gl!.deleteBuffer(buffer)
            gl!.deleteProgram(program)
            gl!.deleteShader(vs)
            gl!.deleteShader(fs)
        },
    }
}

function createCanvas2DRenderer(canvas: HTMLCanvasElement): Renderer | null {
    let ctx: CanvasRenderingContext2D | null = null
    try {
        ctx = canvas.getContext("2d")
    } catch {
        return null
    }
    if (!ctx) return null

    const blobData = new Float32Array(BLOBS.length * 4)
    let gridW = 112
    let gridH = 70
    let imageData: ImageData | null = null

    return {
        resize(width, height) {
            const aspect = Math.max(0.4, width / Math.max(height, 1))
            gridW = aspect >= 1 ? 112 : 76
            gridH = Math.max(52, Math.round(gridW / aspect))
            canvas.width = gridW
            canvas.height = gridH
            imageData = ctx!.createImageData(gridW, gridH)
        },
        draw(seconds) {
            if (!imageData) return
            const aspect = gridW / Math.max(gridH, 1)
            blobCoords(seconds, aspect, blobData)
            const pixels = imageData.data
            for (let py = 0; py < gridH; py++) {
                const y = 0.5 - py / gridH
                for (let px = 0; px < gridW; px++) {
                    const x = (px / gridW - 0.5) * aspect
                    let field = 0
                    let r = 0
                    let g = 0
                    let b = 0
                    for (let i = 0; i < BLOBS.length; i++) {
                        const base = i * 4
                        const dx = x - blobData[base]!
                        const dy = y - blobData[base + 1]!
                        const contrib = blobData[base + 2]! / (dx * dx + dy * dy + 0.0022)
                        const color = BLOBS[i]!.color
                        field += contrib
                        r += color[0] * contrib
                        g += color[1] * contrib
                        b += color[2] * contrib
                    }
                    const inv = 1 / Math.max(field, 0.0001)
                    const cr = r * inv
                    const cg = g * inv
                    const cb = b * inv
                    const halo = smoothstep(0.32, 1.05, field) * 0.11
                    const body = smoothstep(0.84, 1.32, field)
                    const core = 0.76 + 0.24 * Math.exp(-Math.max(field - 1.05, 0) * 0.55)
                    const sheen = Math.exp(-Math.pow((field - 1.06) * 2.8, 2)) * 0.06
                    const alpha = Math.min(0.46, Math.max(0, halo + body * (0.26 * core) + sheen))
                    const offset = (py * gridW + px) * 4
                    pixels[offset] = Math.min(255, Math.round(cr * 255))
                    pixels[offset + 1] = Math.min(255, Math.round(cg * 255))
                    pixels[offset + 2] = Math.min(255, Math.round(cb * 255))
                    pixels[offset + 3] = Math.round(alpha * 255)
                }
            }
            ctx!.putImageData(imageData, 0, 0)
        },
        dispose() {
            imageData = null
        },
    }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
}

const SOFTWARE_FRAME_INTERVAL_MS = 50

/** Full-viewport ambient lava-lamp metaball backdrop behind Midnight Glass panels.
 *  Pauses cleanly when Animations are off or the tab is hidden without recompiling shaders */
export function AmbientLava({ enabled }: { enabled: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const elapsedRef = useRef(STATIC_PHASE_SECONDS)
    const enabledRef = useRef(enabled)
    const loopControlRef = useRef<{ sync: () => void } | null>(null)
    const [rendererMode, setRendererMode] = useState<"webgl" | "2d">("webgl")

    enabledRef.current = enabled

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || typeof window === "undefined") return
        let renderer: Renderer | null =
            rendererMode === "webgl" ? createWebGLRenderer(canvas) : createCanvas2DRenderer(canvas)
        if (!renderer) {
            // Once a canvas acquires a WebGL context, getContext("2d") returns null on that same element; remounting with key="2d" gives a fresh canvas
            if (rendererMode === "webgl") setRendererMode("2d")
            return
        }

        const minFrameInterval = rendererMode === "2d" ? SOFTWARE_FRAME_INTERVAL_MS : 0
        let contextLost = false
        let raf = 0
        let lastFrame = performance.now()
        let lastDraw = 0

        const syncSize = () => {
            if (!renderer || contextLost) return
            renderer.resize(window.innerWidth || 1280, window.innerHeight || 800)
            renderer.draw(elapsedRef.current)
        }
        syncSize()
        window.addEventListener("resize", syncSize)

        const stopLoop = () => {
            if (raf) {
                window.cancelAnimationFrame(raf)
                raf = 0
            }
        }

        const tick = (now: number) => {
            raf = 0
            if (!renderer || contextLost || !enabledRef.current || document.visibilityState === "hidden") return
            if (minFrameInterval > 0 && now - lastDraw < minFrameInterval) {
                raf = window.requestAnimationFrame(tick)
                return
            }
            const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000))
            lastFrame = now
            lastDraw = now
            elapsedRef.current += dt
            renderer.draw(elapsedRef.current)
            raf = window.requestAnimationFrame(tick)
        }

        const startLoop = () => {
            if (!renderer || contextLost || !enabledRef.current || raf || document.visibilityState === "hidden") return
            lastFrame = performance.now()
            lastDraw = 0
            raf = window.requestAnimationFrame(tick)
        }

        const syncLoop = () => {
            if (enabledRef.current && !contextLost && document.visibilityState !== "hidden") startLoop()
            else stopLoop()
        }
        loopControlRef.current = { sync: syncLoop }

        const onVisibility = () => syncLoop()
        const onContextLost = (event: Event) => {
            event.preventDefault()
            contextLost = true
            stopLoop()
            renderer?.dispose()
            renderer = null
        }
        const onContextRestored = () => {
            contextLost = false
            renderer = createWebGLRenderer(canvas)
            if (!renderer) {
                setRendererMode("2d")
                return
            }
            syncSize()
            syncLoop()
        }

        document.addEventListener("visibilitychange", onVisibility)
        if (rendererMode === "webgl") {
            canvas.addEventListener("webglcontextlost", onContextLost)
            canvas.addEventListener("webglcontextrestored", onContextRestored)
        }
        syncLoop()

        return () => {
            loopControlRef.current = null
            stopLoop()
            document.removeEventListener("visibilitychange", onVisibility)
            window.removeEventListener("resize", syncSize)
            if (rendererMode === "webgl") {
                canvas.removeEventListener("webglcontextlost", onContextLost)
                canvas.removeEventListener("webglcontextrestored", onContextRestored)
            }
            renderer?.dispose()
        }
    }, [rendererMode])

    useEffect(() => {
        loopControlRef.current?.sync()
    }, [enabled, rendererMode])

    return <canvas key={rendererMode} ref={canvasRef} className="ambient-lava" aria-hidden="true" />
}
