// Pine Hash-based Router
class PineRouter {
  constructor() {
    this.routes = [];
    this.currentParams = {};
    window.addEventListener('hashchange', () => this.resolve());
  }

  on(pattern, handler) {
    // pattern like 'room/:id' or 'call/:id' or 'invite' or '/'
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
    this.routes.push({ pattern, regex, handler });
    return this;
  }

  resolve() {
    const hash = location.hash.slice(1) || '/';
    for (const route of this.routes) {
      const match = hash.match(route.regex);
      if (match) {
        this.currentParams = match.groups || {};
        route.handler(this.currentParams);
        return;
      }
    }
    // Default: show room list
    if (this.routes.length > 0) {
      this.routes[0].handler({});
    }
  }

  navigate(path) {
    location.hash = path;
  }

  start() {
    this.resolve();
  }
}
