export class SingletonPanel<T> {
  private panel: T | undefined;

  get current(): T | undefined {
    return this.panel;
  }

  show(create: () => T, reveal: (panel: T) => void): T {
    if (this.panel) {
      reveal(this.panel);
      return this.panel;
    }

    this.panel = create();
    return this.panel;
  }

  clear(panel: T): void {
    if (this.panel === panel) {
      this.panel = undefined;
    }
  }
}
