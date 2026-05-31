interface Dot {
  x: number;
  y: number;
  baseOpacity: number;
}

export class DotPatternManager {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;
  private dots: Dot[] = [];
  private mouse = { x: -1000, y: -1000 };
  private animationId: number | null = null;
  private container: HTMLElement;
  private observer!: IntersectionObserver;

  // Settings
  private dotSize = 2;
  private gap = 24;
  private baseColor = { r: 64, g: 64, b: 64 }; // #404040
  private glowColor = { r: 99, g: 102, b: 241 }; // #6366f1 (Indigo)
  private proximity = 120;
  private glowIntensity = 1.0;
  private waveSpeed = 0.5; // Maintained for compilation compatibility if needed

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement("canvas");
    this.canvas.addClass("kanban-dot-background");
    this.ctx = this.canvas.getContext("2d")!;
    container.appendChild(this.canvas);

    this.init();
  }

  private updateColors() {
    if (!document.body) return;
    const isDark = document.body.classList.contains("theme-dark");
    if (isDark) {
      this.baseColor = { r: 64, g: 64, b: 64 }; // #404040
      this.glowColor = { r: 126, g: 87, b: 194 }; // #7e57c2 (Indigo)
    } else {
      this.baseColor = { r: 160, g: 160, b: 160 }; 
      this.glowColor = { r: 216, g: 27, b: 96 }; // #d81b60 (Red/Pink)
    }
    this.drawOffscreen();
    this.requestFrame();
  }

  private init() {
    this.updateColors();
    this.buildGrid();
    
    // Theme change detection
    if (document.body) {
      const themeObserver = new MutationObserver(() => this.updateColors());
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }
    
    const ro = new ResizeObserver(() => this.buildGrid());
    ro.observe(this.container);

    // Mouse listeners
    this.container.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
      this.requestFrame();
    });

    this.container.addEventListener("mouseleave", () => {
      this.mouse.x = -1000;
      this.mouse.y = -1000;
      this.requestFrame();
    });

    // Intersection observer
    this.observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        this.start();
      } else {
        this.stop();
      }
    });
    this.observer.observe(this.container);
  }

  private drawOffscreen() {
    if (!this.offscreenCanvas || !this.offscreenCtx) return;

    const dpr = window.devicePixelRatio || 1;
    this.offscreenCtx.clearRect(0, 0, this.offscreenCanvas.width / dpr, this.offscreenCanvas.height / dpr);

    const radius = this.dotSize / 2;
    for (const dot of this.dots) {
      this.offscreenCtx.fillStyle = `rgba(${this.baseColor.r}, ${this.baseColor.g}, ${this.baseColor.b}, ${dot.baseOpacity})`;
      this.offscreenCtx.beginPath();
      this.offscreenCtx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
      this.offscreenCtx.fill();
    }
  }

  private buildGrid() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    this.ctx.scale(dpr, dpr);

    // Setup offscreen canvas
    this.offscreenCanvas = document.createElement("canvas");
    this.offscreenCanvas.width = this.canvas.width;
    this.offscreenCanvas.height = this.canvas.height;
    this.offscreenCtx = this.offscreenCanvas.getContext("2d")!;
    this.offscreenCtx.scale(dpr, dpr);

    const cellSize = this.dotSize + this.gap;
    const cols = Math.ceil(rect.width / cellSize) + 1;
    const rows = Math.ceil(rect.height / cellSize) + 1;

    const offsetX = (rect.width - (cols - 1) * cellSize) / 2;
    const offsetY = (rect.height - (rows - 1) * cellSize) / 2;

    this.dots = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        this.dots.push({
          x: offsetX + col * cellSize,
          y: offsetY + row * cellSize,
          baseOpacity: 0.6 + Math.random() * 0.2,
        });
      }
    }

    this.drawOffscreen();
    this.requestFrame();
  }

  private requestFrame() {
    if (!this.animationId) {
      this.animationId = requestAnimationFrame(this.draw);
    }
  }

  private draw = () => {
    this.animationId = null;

    const dpr = window.devicePixelRatio || 1;
    this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

    // Draw pre-rendered static background dots
    if (this.offscreenCanvas) {
      this.ctx.drawImage(this.offscreenCanvas, 0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    }

    const { x: mx, y: my } = this.mouse;
    if (mx === -1000 && my === -1000) {
      return;
    }

    const proxSq = this.proximity * this.proximity;

    // Draw active hover glow on top of the base dots
    for (const dot of this.dots) {
      const dx = dot.x - mx;
      const dy = dot.y - my;
      const distSq = dx * dx + dy * dy;

      if (distSq < proxSq) {
        const dist = Math.sqrt(distSq);
        const t = 1 - dist / this.proximity;
        const easedT = t * t * (3 - 2 * t); // smoothstep

        const r = Math.round(this.baseColor.r + (this.glowColor.r - this.baseColor.r) * easedT);
        const g = Math.round(this.baseColor.g + (this.glowColor.g - this.baseColor.g) * easedT);
        const b = Math.round(this.baseColor.b + (this.glowColor.b - this.baseColor.b) * easedT);

        const opacity = Math.min(1, dot.baseOpacity + easedT * 0.7);
        const scale = 1 + easedT * 0.8;
        const glow = easedT * this.glowIntensity;
        const radius = (this.dotSize / 2) * scale;

        // Draw glow effect
        if (glow > 0) {
          const gradient = this.ctx.createRadialGradient(
            dot.x,
            dot.y,
            0,
            dot.x,
            dot.y,
            radius * 4,
          );
          gradient.addColorStop(0, `rgba(${this.glowColor.r}, ${this.glowColor.g}, ${this.glowColor.b}, ${glow * 0.4})`);
          gradient.addColorStop(0.5, `rgba(${this.glowColor.r}, ${this.glowColor.g}, ${this.glowColor.b}, ${glow * 0.1})`);
          gradient.addColorStop(1, `rgba(${this.glowColor.r}, ${this.glowColor.g}, ${this.glowColor.b}, 0)`);
          
          this.ctx.beginPath();
          this.ctx.arc(dot.x, dot.y, radius * 4, 0, Math.PI * 2);
          this.ctx.fillStyle = gradient;
          this.ctx.fill();
        }

        // Draw the highlighted dot
        this.ctx.beginPath();
        this.ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        this.ctx.fill();
      }
    }
  };

  public start() {
    this.requestFrame();
  }

  public stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  public show() {
    this.canvas.style.display = "block";
    this.start();
  }

  public hide() {
    this.canvas.style.display = "none";
    this.stop();
  }

  public destroy() {
    this.stop();
    this.observer.disconnect();
    this.canvas.remove();
  }
}
