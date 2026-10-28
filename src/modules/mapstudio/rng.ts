/* ================================================================
   ClueForge — 种子随机数  |  src/modules/mapstudio/rng.ts
   程序化生成必须可复现：同一个 seed 永远得到同一张图。
   ================================================================ */

export function hashSeed(input: string): number {
    // FNV-1a 32bit
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

export class Rng {
    private state: number;

    constructor(seed: string | number) {
        this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
        if (this.state === 0) this.state = 0x9e3779b9;
    }

    /** [0,1) */
    next(): number {
        // mulberry32
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }

    int(min: number, max: number): number {
        return Math.floor(this.range(min, max + 1));
    }

    pick<T>(list: readonly T[]): T {
        return list[Math.floor(this.next() * list.length) % list.length];
    }

    chance(p: number): boolean {
        return this.next() < p;
    }

    shuffle<T>(list: T[]): T[] {
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            const tmp = list[i];
            list[i] = list[j];
            list[j] = tmp;
        }
        return list;
    }
}
