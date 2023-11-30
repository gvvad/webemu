import { BusMain } from "./bus_main.js"
import { NES_PALETTE } from "./palette.js"

const sprQueLen = 16;

class RenderCanvas {
    /** @param {BusMain} bus */
    constructor(bus) {
        this._ppuBus = bus.ppuBus;
        this._bus = bus;
        this._nes = bus.nes;
        this._ctx = undefined;

        /**[2: {bg, sprt}] [4: palette] [4: color(rgba)] */
        this._framePalettes = new Array(2);
        for (let i = 0; i < 2; i++) {
            this._framePalettes[i] = new Array(4)
            for (let j = 0; j < 4; j++) {
                this._framePalettes[i][j] = new Array(4)
            }
        }

        this._frameBgTileMap = new Uint8Array(32 * 30 * 4);
        this._frameAttribMap = new Uint8Array(32 * 30 * 4);

        this._frameBgPxValMap = new Uint8Array(256 * 240 * 4);
        this._frameBgPxPalMap = new Uint8Array(256 * 240 * 4);

        this._spriteQueueBuffer = new ArrayBuffer(240 * sprQueLen * 6);
        this._u8SpriteQueue = new Uint8Array(this._spriteQueueBuffer);
        /**[240] [aprQueLen]
         * [6: {isSprt[0 - no sprt ; 1 - front; 2 - behind background],
         * xOffset, table, tileId, attrib, tileOffset}] */
        this._spriteQueue = new Array(240);
        for (let i = 0; i < this._spriteQueue.length; i++) {
            this._spriteQueue[i] = new Array(sprQueLen);
            for (let j = 0; j < sprQueLen; j++) {
                this._spriteQueue[i][j] = new Uint8Array(this._spriteQueueBuffer, (i * sprQueLen * 6) + j * 6);
            }
        }

        this._resImageDataBuffer = new ImageData(256, 240);
        this._u32resImageDataBuffer = new Uint32Array(this._resImageDataBuffer.data.buffer);
        this._u8resImageDataBuffer = new Uint8Array(this._resImageDataBuffer.data.buffer);

        //32 bit rgba
        this._rgbaPalette = {};
        for (const key in NES_PALETTE) {
            const el = NES_PALETTE[key];
            this._rgbaPalette[key] = 0xFF000000 | (el[2] << 16) | (el[1] << 8) | el[0];
        }

        this._backgroundColor = 0xFF000000;

        this._isTilesUpdated = false;
    }

    init() {
        this._tileCache = new Array(this._bus.mapper.aTileBank.length);
        for (let i = 0; i < this._tileCache.length; i++) {
            this._tileCache[i] = new Array(512);
            for (let j = 0; j < 512; j++) {
                this._tileCache[i][j] = new Uint8Array(64);
            }
        }
        this._cacheTiles();
        this._bus.mapper.onTileBankChange = () => { this._isTilesUpdated = true; }
    }

    /** @param {CanvasRenderingContext2D} ctx */
    setDrawContext(ctx) {
        this._ctx = ctx;
    }

    _prepareSprites(yPos, tileId, attrib, xPos, table) {
        let yInc = attrib & 0x80 ? -1 : 1;

        let yPx = attrib & 0x80 ? 7 : 0;
        for (let y = 0; (y < 8) && (yPos + y) < 240; y++) {
            for (let i = 0; i < sprQueLen; i++) {
                if (this._spriteQueue[yPos + y][i][0]) continue;
                this._spriteQueue[yPos + y][i][0] = 1;
                this._spriteQueue[yPos + y][i][1] = xPos;   //x offset
                this._spriteQueue[yPos + y][i][2] = table;  //table[0, 1, 2 - current table selector]
                this._spriteQueue[yPos + y][i][3] = tileId; //tileId
                this._spriteQueue[yPos + y][i][4] = attrib; //attrib
                this._spriteQueue[yPos + y][i][5] = (yPx * 8);  //pixel tile offset [0-63]
                break;
            }
            yPx += yInc;
        }
    }

    doFramePredraw() {
        this._u8SpriteQueue.fill(0);
        for (let i = 0; i < 64; i++) {
            let offset = i * 4;
            let y = this._ppuBus.u8Oam[offset] + 1;
            if (y >= 240) continue;
            let tileId = this._ppuBus.u8Oam[offset + 1];
            let attrib = this._ppuBus.u8Oam[offset + 2];
            let x = this._ppuBus.u8Oam[offset + 3];

            let isVFlip = !!(attrib & 0x80);
            if (!this._ppuBus.rCtrl.h) {
                //8x8
                this._prepareSprites(y, tileId, attrib, x, 2);
            } else {
                //8x16
                this._prepareSprites(y, (tileId & 0xFE) | (isVFlip + 0), attrib, x, tileId & 0x1);
                this._prepareSprites(y + 8, (tileId & 0xFE) | (!isVFlip + 0), attrib, x, tileId & 0x1);
            }
        }
    }

    /**Draw current line into inner buffer */
    doLineDraw() {
        let lineNum = this._nes.scanLine;
        if (this._ppuBus.isPalettesUpdated) {
            this._cachePalettes();
        }
        if (this._isTilesUpdated) {
            this._isTilesUpdated = false;
            this._cacheTiles();
        }

        let xPos = this._ppuBus.rAddrScroll.xPos;
        if (this._ppuBus.rAddrScroll.baseTable & 0x1) { xPos += 256; }
        xPos %= 512;

        let yPos = this._ppuBus.rAddrScroll.yPos % 240;

        let hOffset = lineNum * 256;

        let yTile = yPos % 8;
        let tableHiBitNum = this._ppuBus.rAddrScroll.baseTable & 0x2;
        yPos %= 240;
        let nameOffset = (yPos & 0xF8) << 2;
        let attribOffset = (yPos & 0xE0) >> 2;
        let attribHiBit = ((yPos >> 3) & 0x2);

        let showSprFrom = (this._ppuBus.rMask.isSpritesFromLeft) ? 0 : 8;
        let showBgrFrom = (this._ppuBus.rMask.isBackgroundFromLeft) ? 0 : 8;

        let tile = undefined;
        let pal = undefined;
        for (let x = 0; x < 256; x++) {
            let res = this._backgroundColor;
            let xCur = xPos + x;
            if ((xCur % 8) == 0) tile = undefined;

            resCalc: {
                if (this._ppuBus.rMask.isShowSprites && (x >= showSprFrom)) {
                    for (let i = 0; i < sprQueLen; i++) {
                        let el = this._spriteQueue[lineNum][i];
                        if (el[0] == 0) break;
                        let tileX = x - el[1];
                        if (tileX >= 0 && tileX < 8) {
                            let tile = this._getCachedTile(
                                (el[2] & 2) ? this._ppuBus.rCtrl.spriteTable : el[2] & 1,
                                el[3]);
                            let pxVal = tile[el[5] + ((el[4] & 0x40) ? 7 - tileX : tileX)];
                            if (pxVal) {
                                res = this._framePalettes[1][el[4] & 0x3][pxVal];
                                if (el[4] & 0x20) { //is behind background
                                    break;
                                }
                                break resCalc;
                            }
                        }
                    }
                }

                if (this._ppuBus.rMask.isShowBackground && (x >= showBgrFrom)) {
                    let tableNum = tableHiBitNum | (xCur & 0x100) >> 8;
                    xCur %= 256;
                    let xTile = xCur % 8;
                    if (tile == undefined) {
                        let tileId = this._ppuBus.getNameTable(tableNum)[nameOffset + (xCur >> 3)];
                        tile = this._getCachedTile(this._ppuBus.rCtrl.backgroundTable, tileId);
                        let attribByte = this._ppuBus.getAttribTable(tableNum)[attribOffset + (xCur >> 5)];
                        let bit = attribHiBit | ((xCur >> 4) & 0x1);
                        bit <<= 1;
                        pal = (attribByte >> bit) & 0x3;
                    }

                    let pxVal = tile[(yTile * 8) + xTile];
                    if (pxVal) {
                        res = this._framePalettes[0][pal][pxVal];
                    }
                }
            }

            this._u32resImageDataBuffer[hOffset + x] = res;
        }
    }

    /**Put image data from buffer to canvas */
    doShowFrame() {
        if (this._ctx) this._ctx.putImageData(this._resImageDataBuffer, 0, 0);
    }

    /**Clear canvas image */
    doBlankFrame() {
        if (this._ctx) {
            this._u32resImageDataBuffer.fill(0);
            this._ctx.putImageData(this._resImageDataBuffer, 0, 0);
        }
    }

    _cachePalettes() {
        let gsMask = this._ppuBus.rMask.isGreyscale ? 0x30 : 0xFF;
        this._backgroundColor = this._rgbaPalette[this._ppuBus.aPalettes[0][0][0] & gsMask] || 0xFF000000;
        for (let i = 0; i < 2; i++) {
            for (let j = 0; j < 4; j++) {
                for (let c = 0; c < 4; c++) {
                    let val = this._rgbaPalette[this._ppuBus.aPalettes[i][j][c] & gsMask] || 0xFF000000;
                    let r = val & 0xFF;
                    let g = (val >> 8) & 0xFF;
                    let b = (val >> 16) & 0xFF;
                    if (this._ppuBus.rMask.isEmphasisRed) {
                        r *= 1.1;
                        r = (r > 0xFF) ? 0xFF : r;
                        g *= 0.9;
                        b *= 0.9;
                    }
                    if (this._ppuBus.rMask.isEmphasisGreen) {
                        r *= 0.9;
                        g *= 1.1;
                        g = (g > 0xFF) ? 0xFF : g;
                        b *= 0.9;
                    }
                    if (this._ppuBus.rMask.isEmphasisBlue) {
                        r *= 0.9;
                        g *= 0.9;
                        b *= 1.1;
                        b = (b > 0xFF) ? 0xFF : b;
                    }
                    r &= 0xFF;
                    g &= 0xFF;
                    b &= 0xFF;
                    this._framePalettes[i][j][c] = 0xFF000000 | (b << 16) | (g << 8) | r;
                }
            }
        }
    }

    _getCachedTile(table, offset) {
        let res = this._bus.mapper.getTileOffset((table ? 0x1000 : 0x0) | (offset << 4));
        return this._tileCache[res[0]][res[1] >> 4];

    }
    _cacheTiles() {
        for (let b = 0; b < this._bus.mapper.aTileBank.length; b++) {
            for (let i = 0; i < 512; i++) {
                let offset = i * 0x10;
                for (let y = 0; y < 8; y++) {
                    let lo = this._bus.mapper.aTileBank[b][offset + y];
                    let hi = this._bus.mapper.aTileBank[b][offset + y + 8];
                    let r = y * 8;

                    this._tileCache[b][i][r + 0] = (lo & 0x80) >> 7;
                    this._tileCache[b][i][r + 1] = (lo & 0x40) >> 6;
                    this._tileCache[b][i][r + 2] = (lo & 0x20) >> 5;
                    this._tileCache[b][i][r + 3] = (lo & 0x10) >> 4;
                    this._tileCache[b][i][r + 4] = (lo & 0x08) >> 3;
                    this._tileCache[b][i][r + 5] = (lo & 0x04) >> 2;
                    this._tileCache[b][i][r + 6] = (lo & 0x02) >> 1;
                    this._tileCache[b][i][r + 7] = (lo & 0x01);

                    this._tileCache[b][i][r + 0] |= (hi & 0x80) >> 6;
                    this._tileCache[b][i][r + 1] |= (hi & 0x40) >> 5;
                    this._tileCache[b][i][r + 2] |= (hi & 0x20) >> 4;
                    this._tileCache[b][i][r + 3] |= (hi & 0x10) >> 3;
                    this._tileCache[b][i][r + 4] |= (hi & 0x08) >> 2;
                    this._tileCache[b][i][r + 5] |= (hi & 0x04) >> 1;
                    this._tileCache[b][i][r + 6] |= (hi & 0x02);
                    this._tileCache[b][i][r + 7] |= (hi & 0x01) << 1;
                }
            }
        }
    }
}

export { RenderCanvas };