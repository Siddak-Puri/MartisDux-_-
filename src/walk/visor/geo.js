const deg = 180 / Math.PI;

export class Heightfield {
  constructor(grid, data) {
    Object.assign(this, { nx: grid.nx, nz: grid.nz, step: grid.step, hmin: grid.hmin, unit: grid.heightUnit, data });
    this.width = (this.nx - 1) * this.step; this.depth = (this.nz - 1) * this.step;
  }
  at(c, r) {
    c = Math.max(0, Math.min(this.nx - 1, c)); r = Math.max(0, Math.min(this.nz - 1, r));
    return this.data[r * this.nx + c] * this.unit;
  }
  height(x, z) {
    const fx = Math.max(0, Math.min(this.nx - 1.000001, x / this.step)), fz = Math.max(0, Math.min(this.nz - 1.000001, z / this.step));
    const c = Math.floor(fx), r = Math.floor(fz), a = fx - c, b = fz - r;
    return (this.at(c, r) * (1 - a) + this.at(c + 1, r) * a) * (1 - b) + (this.at(c, r + 1) * (1 - a) + this.at(c + 1, r + 1) * a) * b;
  }
  inside(x, z) { return x >= 0 && z >= 0 && x <= this.width && z <= this.depth; }
  slope(x, z, span = 2) {
    const gx = (this.height(x + span, z) - this.height(x - span, z)) / (2 * span);
    const gz = (this.height(x, z + span) - this.height(x, z - span)) / (2 * span);
    return Math.atan(Math.hypot(gx, gz)) * deg;
  }
  gradeAlong(x, z, dx, dz, dist = 5) {
    const L = Math.hypot(dx, dz) || 1;
    return Math.atan2(this.height(x + dx / L * dist, z + dz / L * dist) - this.height(x, z), dist) * deg;
  }
}

export const bearing = (dx, dz) => ((Math.atan2(dx, -dz) * deg) % 360 + 360) % 360;
export const turn = (from, to) => ((to - from + 540) % 360) - 180;

export class Route {
  constructor(points) {
    this.points = points; this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    this.length = this.cum.at(-1);
  }
  at(s) {
    s = Math.max(0, Math.min(this.length, s));
    let i = 1; while (i < this.points.length - 1 && this.cum[i] < s) i++;
    const [ax, az] = this.points[i - 1], [bx, bz] = this.points[i], L = this.cum[i] - this.cum[i - 1] || 1, t = (s - this.cum[i - 1]) / L;
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / L, dz: (bz - az) / L };
  }
  project(x, z) {
    let best = { along: 0, off: Infinity, x: 0, z: 0 };
    for (let i = 1; i < this.points.length; i++) {
      const [ax, az] = this.points[i - 1], [bx, bz] = this.points[i], vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
      const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)) : 0;
      const qx = ax + vx * t, qz = az + vz * t, off = Math.hypot(x - qx, z - qz);
      if (off < best.off) best = { along: this.cum[i - 1] + Math.sqrt(L2) * t, off, x: qx, z: qz };
    }
    return best;
  }
  sample(spacing = 1) {
    const out = [];
    for (let s = 0; s < this.length; s += spacing) out.push(this.at(s));
    out.push(this.at(this.length));
    return out;
  }
}

export const toLatLon = (geo, x, z) => ({ lat: geo.north - z / geo.metresPerDegLat, lon: geo.west + x / geo.metresPerDegLon });
