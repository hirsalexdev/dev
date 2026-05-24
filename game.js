// Snowbusters Demo — a playable version of what Whiteout Survival ads promise.

const TILE = 20;
const COLS = 48;
const ROWS = 32;
const GAME_W = COLS * TILE;
const GAME_H = ROWS * TILE;

const CONFIG = {
    fuelStart: 100,
    fuelMax: 100,
    hpStart: 100,
    hpMax: 100,
    fuelDrainPerSecond: 4,
    moveSpeed: 140,
    baseClearRadius: 28,
    radiusPerSurvivor: 10,
    fireRegenBase: 2,
    fireRegenPerLevel: 3,
    fireRegenRadius: 110,
    coalPerFireLevel: 3,
    maxFireLevel: 5,
    survivorRescueSeconds: 1.6,
    beastHp: 40,
    beastDamage: 18,
    beastAttackCooldownMs: 900,
    beastSpeed: 28,
    playerAttackDamage: 22,
    playerAttackCooldownMs: 350,
    winThreshold: 0.95,
    survivorCount: 4,
    beastCount: 3,
    coalNodes: 8,
};

class SnowbustersScene extends Phaser.Scene {
    constructor() {
        super('SnowbustersScene');
    }

    create() {
        this.cameras.main.setBackgroundColor('#1a3a52');

        this.snowGrid = [];
        this.snowTiles = [];
        this.totalSnowCells = 0;
        this.clearedSnowCells = 0;

        this.buildGround();
        this.buildSnowLayer();
        this.buildFirePit();
        this.spawnEntities();
        this.buildPlayer();
        this.setupInput();
        this.setupHud();

        this.state = {
            fuel: CONFIG.fuelStart,
            hp: CONFIG.hpStart,
            coal: 0,
            fireLevel: 1,
            survivorsRescued: 0,
            rescuing: null,
            rescueProgress: 0,
            lastPlayerAttack: 0,
            gameOver: false,
            won: false,
        };

        this.refreshHud();

        this.events.on('shutdown', () => this.cleanup());
    }

    buildGround() {
        const g = this.add.graphics();
        g.fillStyle(0x2c4a64, 1);
        g.fillRect(0, 0, GAME_W, GAME_H);
        // subtle ground texture
        g.fillStyle(0x32547280, 0.5);
        for (let i = 0; i < 80; i++) {
            const x = Phaser.Math.Between(0, GAME_W);
            const y = Phaser.Math.Between(0, GAME_H);
            g.fillCircle(x, y, Phaser.Math.Between(8, 22));
        }
    }

    buildSnowLayer() {
        if (!this.textures.exists('snow-tile')) {
            const tex = this.textures.createCanvas('snow-tile', TILE, TILE);
            const ctx = tex.getContext();
            const grad = ctx.createLinearGradient(0, 0, TILE, TILE);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(1, '#dde9f2');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, TILE, TILE);
            ctx.fillStyle = 'rgba(150, 180, 200, 0.35)';
            for (let i = 0; i < 8; i++) {
                ctx.fillRect(Math.random() * TILE, Math.random() * TILE, 1.5, 1.5);
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.45)';
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
            tex.refresh();
        }

        this.snowGroup = this.add.group();
        for (let r = 0; r < ROWS; r++) {
            this.snowGrid[r] = [];
            this.snowTiles[r] = [];
            for (let c = 0; c < COLS; c++) {
                this.snowGrid[r][c] = true;
                const t = this.add.image(c * TILE + TILE / 2, r * TILE + TILE / 2, 'snow-tile');
                this.snowTiles[r][c] = t;
                this.totalSnowCells++;
            }
        }
    }

    buildFirePit() {
        this.fireX = GAME_W / 2;
        this.fireY = GAME_H / 2;
        // clear snow around the fire so player has a starting safe zone
        this.clearSnowCircle(this.fireX, this.fireY, 60);

        const pit = this.add.graphics();
        pit.fillStyle(0x1c1c1c, 1);
        pit.fillCircle(this.fireX, this.fireY, 26);
        pit.lineStyle(3, 0x4a3a2a, 1);
        pit.strokeCircle(this.fireX, this.fireY, 26);

        // stones around pit
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const sx = this.fireX + Math.cos(a) * 26;
            const sy = this.fireY + Math.sin(a) * 26;
            const stone = this.add.circle(sx, sy, 5, 0x4a4a4a);
            stone.setStrokeStyle(1, 0x2a2a2a);
        }

        this.fireEmoji = this.add.text(this.fireX, this.fireY - 4, '🔥', {
            fontSize: '36px',
        }).setOrigin(0.5);

        // regen aura indicator (subtle)
        this.fireAura = this.add.graphics();
        this.drawFireAura();

        this.tweens.add({
            targets: this.fireEmoji,
            scale: { from: 1, to: 1.12 },
            duration: 700,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
    }

    drawFireAura() {
        this.fireAura.clear();
        const radius = CONFIG.fireRegenRadius;
        this.fireAura.lineStyle(2, 0xffaa44, 0.18);
        this.fireAura.strokeCircle(this.fireX, this.fireY, radius);
        this.fireAura.fillStyle(0xffaa44, 0.05);
        this.fireAura.fillCircle(this.fireX, this.fireY, radius);
    }

    spawnEntities() {
        this.survivors = [];
        this.beasts = [];
        this.coalNodes = [];

        const minDistFromFire = 140;
        const usedPositions = [{ x: this.fireX, y: this.fireY, r: minDistFromFire }];

        const findSpot = (minDist) => {
            for (let tries = 0; tries < 80; tries++) {
                const x = Phaser.Math.Between(60, GAME_W - 60);
                const y = Phaser.Math.Between(60, GAME_H - 60);
                let ok = true;
                for (const p of usedPositions) {
                    if (Phaser.Math.Distance.Between(x, y, p.x, p.y) < (p.r || 0) + minDist) {
                        ok = false;
                        break;
                    }
                }
                if (ok) {
                    usedPositions.push({ x, y, r: minDist });
                    return { x, y };
                }
            }
            return { x: Phaser.Math.Between(60, GAME_W - 60), y: Phaser.Math.Between(60, GAME_H - 60) };
        };

        for (let i = 0; i < CONFIG.survivorCount; i++) {
            const { x, y } = findSpot(70);
            const ice = this.add.rectangle(x, y, 32, 38, 0x9fd8ff, 0.55);
            ice.setStrokeStyle(2, 0xc7eaff);
            const emoji = this.add.text(x, y, '🧑', { fontSize: '22px' }).setOrigin(0.5);
            emoji.setAlpha(0.6);
            const tag = this.add.text(x, y - 30, '❄️', { fontSize: '14px' }).setOrigin(0.5);
            this.survivors.push({ x, y, ice, emoji, tag, rescued: false });
        }

        for (let i = 0; i < CONFIG.beastCount; i++) {
            const { x, y } = findSpot(90);
            const body = this.add.circle(x, y, 18, 0x3a2a2a);
            body.setStrokeStyle(2, 0x6a4a3a);
            const emoji = this.add.text(x, y, '🐻', { fontSize: '24px' }).setOrigin(0.5);
            const hpBar = this.add.graphics();
            const beast = {
                x, y, body, emoji, hpBar,
                hp: CONFIG.beastHp,
                maxHp: CONFIG.beastHp,
                alive: true,
                lastAttack: 0,
                vx: 0, vy: 0,
                wanderTimer: 0,
            };
            this.updateBeastHpBar(beast);
            this.beasts.push(beast);
        }

        for (let i = 0; i < CONFIG.coalNodes; i++) {
            const { x, y } = findSpot(50);
            const rock = this.add.circle(x, y, 11, 0x1c1c1c);
            rock.setStrokeStyle(2, 0x3a3a3a);
            const emoji = this.add.text(x, y, '🪨', { fontSize: '14px' }).setOrigin(0.5);
            this.coalNodes.push({ x, y, rock, emoji, collected: false, amount: Phaser.Math.Between(2, 4) });
        }
    }

    updateBeastHpBar(beast) {
        beast.hpBar.clear();
        if (!beast.alive) return;
        const w = 36;
        const h = 4;
        const x = beast.x - w / 2;
        const y = beast.y - 28;
        beast.hpBar.fillStyle(0x000000, 0.6);
        beast.hpBar.fillRect(x - 1, y - 1, w + 2, h + 2);
        beast.hpBar.fillStyle(0xff4444, 1);
        beast.hpBar.fillRect(x, y, w * (beast.hp / beast.maxHp), h);
    }

    buildPlayer() {
        this.player = {
            x: this.fireX,
            y: this.fireY + 50,
            radius: CONFIG.baseClearRadius,
            attacking: false,
            invulnUntil: 0,
        };
        this.playerBody = this.add.circle(this.player.x, this.player.y, 14, 0x4cb5f5);
        this.playerBody.setStrokeStyle(2, 0xffffff);
        this.playerEmoji = this.add.text(this.player.x, this.player.y, '🥽', { fontSize: '18px' }).setOrigin(0.5);

        // radius indicator
        this.playerAura = this.add.graphics();
        this.drawPlayerAura();

        // rescue progress ring
        this.rescueRing = this.add.graphics();
    }

    drawPlayerAura() {
        this.playerAura.clear();
        this.playerAura.lineStyle(1.5, 0x4cb5f5, 0.5);
        this.playerAura.strokeCircle(this.player.x, this.player.y, this.player.radius);
    }

    setupInput() {
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({
            up: 'W', down: 'S', left: 'A', right: 'D',
            action: 'SPACE',
            interact: 'E',
        });
    }

    setupHud() {
        this.hud = {
            fuelBar: document.getElementById('fuel-bar'),
            fuelValue: document.getElementById('fuel-value'),
            hpBar: document.getElementById('hp-bar'),
            hpValue: document.getElementById('hp-value'),
            coal: document.getElementById('coal-value'),
            fireLevel: document.getElementById('fire-level'),
            survivor: document.getElementById('survivor-value'),
            survivorTotal: document.getElementById('survivor-total'),
            snowPercent: document.getElementById('snow-percent'),
            rocket: document.getElementById('rocket-button'),
            overlay: document.getElementById('overlay'),
            overlayTitle: document.getElementById('overlay-title'),
            overlayText: document.getElementById('overlay-text'),
            overlayButton: document.getElementById('overlay-button'),
        };
        this.hud.survivorTotal.textContent = CONFIG.survivorCount;

        // use .onclick to avoid stacking listeners across scene restarts
        this.hud.rocket.onclick = () => {
            if (this.state.gameOver) return;
            this.triggerWin('rocket');
        };

        this.hud.overlayButton.onclick = () => {
            this.hud.overlay.classList.add('hidden');
            this.hud.rocket.classList.add('hidden');
            this.scene.restart();
        };
    }

    refreshHud() {
        const s = this.state;
        const fuelPct = Phaser.Math.Clamp((s.fuel / CONFIG.fuelMax) * 100, 0, 100);
        const hpPct = Phaser.Math.Clamp((s.hp / CONFIG.hpMax) * 100, 0, 100);
        this.hud.fuelBar.style.width = `${fuelPct}%`;
        this.hud.fuelValue.textContent = Math.ceil(s.fuel);
        this.hud.hpBar.style.width = `${hpPct}%`;
        this.hud.hpValue.textContent = Math.ceil(s.hp);
        this.hud.coal.textContent = s.coal;
        this.hud.fireLevel.textContent = s.fireLevel;
        this.hud.survivor.textContent = s.survivorsRescued;
        const snowPct = Math.floor((this.clearedSnowCells / this.totalSnowCells) * 100);
        this.hud.snowPercent.textContent = snowPct;

        if (snowPct >= CONFIG.winThreshold * 100) {
            this.hud.rocket.classList.remove('hidden');
        }
    }

    update(time, delta) {
        if (this.state.gameOver) return;
        const dt = delta / 1000;

        this.handleMovement(dt);
        this.handleSnowClearing();
        this.handleFireRegen(dt);
        this.handleBeasts(time, dt);
        this.handleCoalPickup();
        this.handleSurvivors(time, dt);
        this.handleInteract(time);
        this.handleAttack(time);

        this.state.fuel = Math.max(0, this.state.fuel - CONFIG.fuelDrainPerSecond * dt * (this.isMoving ? 1 : 0.2));
        if (this.state.fuel <= 0) {
            this.triggerLoss('fuel');
            return;
        }
        if (this.state.hp <= 0) {
            this.triggerLoss('hp');
            return;
        }

        this.refreshHud();
    }

    handleMovement(dt) {
        let dx = 0, dy = 0;
        if (this.cursors.left.isDown || this.wasd.left.isDown) dx -= 1;
        if (this.cursors.right.isDown || this.wasd.right.isDown) dx += 1;
        if (this.cursors.up.isDown || this.wasd.up.isDown) dy -= 1;
        if (this.cursors.down.isDown || this.wasd.down.isDown) dy += 1;

        // can't move while rescuing
        if (this.state.rescuing) { dx = 0; dy = 0; }

        const len = Math.hypot(dx, dy);
        this.isMoving = len > 0;
        if (this.isMoving) {
            dx /= len; dy /= len;
            const nx = Phaser.Math.Clamp(this.player.x + dx * CONFIG.moveSpeed * dt, 14, GAME_W - 14);
            const ny = Phaser.Math.Clamp(this.player.y + dy * CONFIG.moveSpeed * dt, 14, GAME_H - 14);
            this.player.x = nx;
            this.player.y = ny;
            this.playerBody.setPosition(nx, ny);
            this.playerEmoji.setPosition(nx, ny);
            this.drawPlayerAura();
        }
    }

    handleSnowClearing() {
        if (!this.isMoving) return;
        this.clearSnowCircle(this.player.x, this.player.y, this.player.radius);
    }

    clearSnowCircle(cx, cy, radius) {
        const r2 = radius * radius;
        const minC = Math.max(0, Math.floor((cx - radius) / TILE));
        const maxC = Math.min(COLS - 1, Math.floor((cx + radius) / TILE));
        const minR = Math.max(0, Math.floor((cy - radius) / TILE));
        const maxR = Math.min(ROWS - 1, Math.floor((cy + radius) / TILE));
        let changed = false;
        for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
                if (!this.snowGrid[r][c]) continue;
                const tx = c * TILE + TILE / 2;
                const ty = r * TILE + TILE / 2;
                const d2 = (tx - cx) * (tx - cx) + (ty - cy) * (ty - cy);
                if (d2 <= r2) {
                    this.snowGrid[r][c] = false;
                    this.clearedSnowCells++;
                    const tile = this.snowTiles[r][c];
                    this.tweens.add({
                        targets: tile,
                        alpha: 0,
                        scale: 0.6,
                        duration: 180,
                        ease: 'Cubic.easeIn',
                        onComplete: () => tile.setVisible(false),
                    });
                    changed = true;
                }
            }
        }
        return changed;
    }

    handleFireRegen(dt) {
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.fireX, this.fireY);
        if (d < CONFIG.fireRegenRadius) {
            const regen = CONFIG.fireRegenBase + (this.state.fireLevel - 1) * CONFIG.fireRegenPerLevel;
            this.state.hp = Math.min(CONFIG.hpMax, this.state.hp + regen * dt);
            // also slowly recover fuel when at fire and not moving
            if (!this.isMoving && d < 50) {
                this.state.fuel = Math.min(CONFIG.fuelMax, this.state.fuel + 6 * dt);
            }
        }
    }

    handleBeasts(time, dt) {
        for (const b of this.beasts) {
            if (!b.alive) continue;

            // Move toward player if close, otherwise wander
            const d = Phaser.Math.Distance.Between(b.x, b.y, this.player.x, this.player.y);
            if (d < 160) {
                const a = Math.atan2(this.player.y - b.y, this.player.x - b.x);
                b.vx = Math.cos(a) * CONFIG.beastSpeed;
                b.vy = Math.sin(a) * CONFIG.beastSpeed;
            } else {
                b.wanderTimer -= dt;
                if (b.wanderTimer <= 0) {
                    const a = Math.random() * Math.PI * 2;
                    b.vx = Math.cos(a) * CONFIG.beastSpeed * 0.4;
                    b.vy = Math.sin(a) * CONFIG.beastSpeed * 0.4;
                    b.wanderTimer = Phaser.Math.FloatBetween(1.5, 3.5);
                }
            }
            b.x = Phaser.Math.Clamp(b.x + b.vx * dt, 20, GAME_W - 20);
            b.y = Phaser.Math.Clamp(b.y + b.vy * dt, 20, GAME_H - 20);
            b.body.setPosition(b.x, b.y);
            b.emoji.setPosition(b.x, b.y);
            this.updateBeastHpBar(b);

            // Attack player on contact
            if (d < 28 && time > b.lastAttack + CONFIG.beastAttackCooldownMs && time > this.player.invulnUntil) {
                this.state.hp -= CONFIG.beastDamage;
                b.lastAttack = time;
                this.player.invulnUntil = time + 400;
                this.cameras.main.shake(120, 0.008);
                this.flashSprite(this.playerBody, 0xff5555);
            }
        }
    }

    handleCoalPickup() {
        for (const n of this.coalNodes) {
            if (n.collected) continue;
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, n.x, n.y);
            if (d < 22) {
                n.collected = true;
                this.state.coal += n.amount;
                this.floatingText(n.x, n.y, `+${n.amount} 🪨`, '#ffcc66');
                this.tweens.add({
                    targets: [n.rock, n.emoji],
                    alpha: 0,
                    scale: 0.2,
                    duration: 250,
                    onComplete: () => { n.rock.destroy(); n.emoji.destroy(); },
                });
            }
        }
    }

    handleSurvivors(time, dt) {
        const actionDown = this.wasd.action.isDown;

        if (this.state.rescuing) {
            const s = this.state.rescuing;
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
            if (!actionDown || d > 40) {
                this.cancelRescue();
            } else {
                this.state.rescueProgress += dt;
                this.drawRescueRing(s, this.state.rescueProgress / CONFIG.survivorRescueSeconds);
                if (this.state.rescueProgress >= CONFIG.survivorRescueSeconds) {
                    this.completeRescue(s);
                }
            }
            return;
        }

        if (actionDown) {
            // find nearest unfrozen survivor in range
            for (const s of this.survivors) {
                if (s.rescued) continue;
                const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
                if (d < 40) {
                    this.state.rescuing = s;
                    this.state.rescueProgress = 0;
                    return;
                }
            }
        }
    }

    cancelRescue() {
        this.state.rescuing = null;
        this.state.rescueProgress = 0;
        this.rescueRing.clear();
    }

    completeRescue(s) {
        s.rescued = true;
        this.state.survivorsRescued++;
        this.state.rescuing = null;
        this.state.rescueProgress = 0;
        this.rescueRing.clear();
        this.player.radius += CONFIG.radiusPerSurvivor;
        this.drawPlayerAura();

        this.tweens.add({
            targets: s.ice,
            alpha: 0,
            scaleX: 1.5,
            scaleY: 1.5,
            duration: 350,
            onComplete: () => s.ice.destroy(),
        });
        s.tag.setText('✓');
        s.tag.setColor('#9bff9b');
        s.emoji.setAlpha(1);
        this.tweens.add({
            targets: s.emoji,
            y: s.emoji.y - 6,
            duration: 200,
            yoyo: true,
        });

        this.floatingText(s.x, s.y - 20, '+Reichweite', '#9bff9b');
    }

    drawRescueRing(s, progress) {
        this.rescueRing.clear();
        const p = Phaser.Math.Clamp(progress, 0, 1);
        this.rescueRing.lineStyle(4, 0x9bff9b, 0.9);
        this.rescueRing.beginPath();
        this.rescueRing.arc(s.x, s.y, 24, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        this.rescueRing.strokePath();
    }

    handleInteract(time) {
        if (!Phaser.Input.Keyboard.JustDown(this.wasd.interact)) return;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.fireX, this.fireY);
        if (d < 60 && this.state.coal >= CONFIG.coalPerFireLevel && this.state.fireLevel < CONFIG.maxFireLevel) {
            this.state.coal -= CONFIG.coalPerFireLevel;
            this.state.fireLevel++;
            this.fireEmoji.setScale(1 + this.state.fireLevel * 0.05);
            this.floatingText(this.fireX, this.fireY - 30, `Feuer Lv${this.state.fireLevel}!`, '#ffaa44');
            this.cameras.main.flash(180, 255, 170, 80, false);
        } else if (d < 60 && this.state.coal < CONFIG.coalPerFireLevel) {
            this.floatingText(this.fireX, this.fireY - 30, `Brauche ${CONFIG.coalPerFireLevel} Kohle`, '#ff8866');
        }
    }

    handleAttack(time) {
        if (!Phaser.Input.Keyboard.JustDown(this.wasd.action)) return;
        // Only attack if not in rescue range (rescue takes precedence)
        for (const s of this.survivors) {
            if (s.rescued) continue;
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
            if (d < 40) return; // rescue intent
        }
        if (time < this.state.lastPlayerAttack + CONFIG.playerAttackCooldownMs) return;
        for (const b of this.beasts) {
            if (!b.alive) continue;
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y);
            if (d < 42) {
                b.hp -= CONFIG.playerAttackDamage;
                this.state.lastPlayerAttack = time;
                this.flashSprite(b.body, 0xffffff);
                this.floatingText(b.x, b.y - 24, `-${CONFIG.playerAttackDamage}`, '#ff8888');
                if (b.hp <= 0) {
                    this.killBeast(b);
                }
                return;
            }
        }
    }

    killBeast(b) {
        b.alive = false;
        b.hpBar.clear();
        const coalDrop = Phaser.Math.Between(3, 5);
        const fuelDrop = Phaser.Math.Between(15, 25);
        this.state.coal += coalDrop;
        this.state.fuel = Math.min(CONFIG.fuelMax, this.state.fuel + fuelDrop);
        this.floatingText(b.x, b.y - 10, `+${coalDrop}🪨  +${fuelDrop}⛽`, '#ffd66e');
        this.tweens.add({
            targets: [b.body, b.emoji],
            alpha: 0,
            scale: 0.3,
            angle: 180,
            duration: 450,
            onComplete: () => { b.body.destroy(); b.emoji.destroy(); },
        });
    }

    floatingText(x, y, text, color = '#ffffff') {
        const t = this.add.text(x, y, text, {
            fontSize: '14px',
            fontStyle: 'bold',
            color,
            stroke: '#000000',
            strokeThickness: 3,
        }).setOrigin(0.5);
        this.tweens.add({
            targets: t,
            y: y - 24,
            alpha: 0,
            duration: 900,
            ease: 'Cubic.easeOut',
            onComplete: () => t.destroy(),
        });
    }

    flashSprite(sprite, color) {
        const orig = sprite.fillColor !== undefined ? sprite.fillColor : null;
        if (orig === null) return;
        sprite.setFillStyle(color);
        this.time.delayedCall(120, () => {
            if (sprite.active) sprite.setFillStyle(orig);
        });
    }

    triggerWin(reason) {
        this.state.gameOver = true;
        this.state.won = true;

        // launch rocket animation
        const rocket = this.add.text(this.player.x, this.player.y, '🚀', { fontSize: '40px' }).setOrigin(0.5);
        this.tweens.add({
            targets: rocket,
            y: -80,
            scale: 2,
            duration: 1100,
            ease: 'Cubic.easeIn',
            onComplete: () => rocket.destroy(),
        });

        // clear all remaining snow
        this.time.delayedCall(700, () => {
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    if (this.snowGrid[r][c]) {
                        this.snowGrid[r][c] = false;
                        this.clearedSnowCells++;
                        const tile = this.snowTiles[r][c];
                        this.tweens.add({
                            targets: tile,
                            alpha: 0,
                            duration: 350,
                            delay: Math.random() * 300,
                            onComplete: () => tile.setVisible(false),
                        });
                    }
                }
            }
            this.cameras.main.flash(400, 255, 255, 255, false);
            this.refreshHud();
        });

        this.time.delayedCall(1800, () => {
            this.hud.overlayTitle.textContent = '🚀 Stage geschafft!';
            const snowPct = Math.floor((this.clearedSnowCells / this.totalSnowCells) * 100);
            this.hud.overlayText.innerHTML = `
                Schnee geräumt: <strong>${snowPct}%</strong><br>
                Survivors gerettet: <strong>${this.state.survivorsRescued}/${CONFIG.survivorCount}</strong><br>
                Bestien erlegt: <strong>${this.beasts.filter(b => !b.alive).length}/${this.beasts.length}</strong><br>
                Feuer-Level: <strong>${this.state.fireLevel}</strong>
            `;
            this.hud.overlayButton.textContent = 'Neue Stage';
            this.hud.overlay.classList.remove('hidden');
            this.hud.rocket.classList.add('hidden');
        });
    }

    triggerLoss(reason) {
        if (this.state.gameOver) return;
        this.state.gameOver = true;

        this.hud.overlayTitle.textContent = reason === 'fuel' ? '⛽ Treibstoff alle!' : '💀 Erfroren …';
        this.hud.overlayText.innerHTML = reason === 'fuel'
            ? 'Ohne Fuel kannst du nicht mehr räumen. Versuch\'s nochmal.'
            : 'Die Kälte und die Bestien haben dich erwischt.';
        this.hud.overlayButton.textContent = 'Nochmal';
        this.hud.overlay.classList.remove('hidden');
        this.hud.rocket.classList.add('hidden');
    }

    cleanup() {
        // remove HUD event listeners if needed; nothing critical here.
    }
}

// Bootstrap once the user clicks "Loslegen"
function startGame() {
    const config = {
        type: Phaser.AUTO,
        width: GAME_W,
        height: GAME_H,
        parent: 'phaser-mount',
        backgroundColor: '#1a3a52',
        scene: [SnowbustersScene],
        pixelArt: false,
        fps: { target: 60, forceSetTimeOut: true },
        disableContextMenu: true,
    };
    window.__phaserGame = new Phaser.Game(config);
}

document.getElementById('start-button').addEventListener('click', () => {
    document.getElementById('intro-overlay').classList.add('hidden');
    startGame();
});
