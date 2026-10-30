import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vector2 } from '@dogfight/shared/sim/vector.js'
import {
  Asteroid,
  Bullet,
  Entity,
  Pickup,
  Ship,
  SHIP_HP,
} from '@dogfight/shared/sim/entity.js'
import { World } from '@dogfight/shared/sim/world.js'
import { circlesOverlap, naivePairs } from '@dogfight/shared/sim/collision.js'
import { makeHoming } from '@dogfight/shared/sim/behaviors.js'

const DT = 1 / 60

test('Vector2: методи не мутують аргументи', () => {
  const a = new Vector2(1, 2)
  const b = new Vector2(3, 4)
  const c = a.add(b)
  assert.deepEqual([a.x, a.y, b.x, b.y, c.x, c.y], [1, 2, 3, 4, 4, 6])
  assert.equal(b.length(), 5)
  assert.deepEqual(new Vector2(0, 0).normalize(), new Vector2(0, 0)) // граничний випадок
  const r = new Vector2(1, 0).rotate(Math.PI / 2)
  assert.ok(Math.abs(r.x) < 1e-12 && Math.abs(r.y - 1) < 1e-12)
  assert.equal(a.dot(b), 11)
})

test('Entity: id унікальні, приватний #id недоступний ззовні', () => {
  const a = new Entity({ kind: 'x' })
  const b = new Entity({ kind: 'x' })
  assert.notEqual(a.id, b.id)
  assert.equal(Object.keys(a).includes('#id'), false)
  assert.throws(() => (a.id = 5), TypeError) // лише getter
})

test('Ship extends Entity — рівно один рівень', () => {
  assert.equal(Object.getPrototypeOf(Ship.prototype), Entity.prototype)
  assert.equal(Object.getPrototypeOf(Entity.prototype), Object.prototype)
})

test('#hp приватне, get hp() працює, damage не йде нижче 0', () => {
  const s = new Ship()
  assert.equal(s.hp, SHIP_HP)
  assert.equal(s.damage(30), false)
  assert.equal(s.hp, 70)
  assert.equal(s.damage(1000), true)
  assert.equal(s.hp, 0)
  assert.equal(s.damage(10), false) // вже знищений
})

test('World: Map, ітерація, ofKind, відкладене видалення', () => {
  const w = new World({ seed: 1 })
  const s = w.spawn(new Ship({ x: 100, y: 100 }))
  const b = w.spawn(new Bullet({ x: 500, y: 500, owner: s.id, ttl: 10 }))
  assert.equal(w.size, 2)
  assert.deepEqual([...w.ofKind('bullet')], [b])
  w.despawn(b.id)
  assert.equal(w.size, 2) // ще не видалено
  w.sweep()
  assert.equal(w.size, 1)
  w.despawn(999999) // неіснуючий id — без помилки
})

test('Bullet зникає після TTL', () => {
  const w = new World()
  w.spawn(new Bullet({ x: 10, y: 10, owner: 0, ttl: 0.5 }))
  for (let i = 0; i < 31; i++) w.step(DT)
  assert.equal([...w.ofKind('bullet')].length, 0)
})

test('fire(): куля з носа, швидкість корабля + куля, кулдаун', () => {
  const w = new World()
  const s = w.spawn(new Ship({ x: 100, y: 100 }))
  s.angle = 0
  s.vel = new Vector2(50, 0)
  const b = s.fire()
  assert.ok(b.pos.x > s.pos.x + s.radius)
  assert.equal(b.vel.x, 50 + 620)
  assert.equal(s.fire(), null) // кулдаун
})

test('колізії: дотик не рахується, перетин — так', () => {
  const a = new Entity({ kind: 'a', x: 0, y: 0, radius: 5 })
  const b = new Entity({ kind: 'b', x: 10, y: 0, radius: 5 })
  assert.equal(circlesOverlap(a, b), false)
  b.pos = new Vector2(9.9, 0)
  assert.equal(circlesOverlap(a, b), true)
  assert.equal(naivePairs([a, b]).length, 1)
})

test("куля б'є чужий корабель, а не власника", () => {
  const w = new World()
  const me = w.spawn(new Ship({ x: 100, y: 100 }))
  const foe = w.spawn(new Ship({ x: 200, y: 100 }))
  w.spawn(new Bullet({ x: 100, y: 100, owner: me.id }))
  w.spawn(new Bullet({ x: 200, y: 100, owner: me.id }))
  w.step(DT)
  assert.equal(me.hp, SHIP_HP)
  assert.equal(foe.hp, SHIP_HP - 25)
})

test('знищення: очко стрільцю, вибух, респаун через 2 с', () => {
  const events = []
  const w = new World({ emit: (t) => events.push(t) })
  const me = w.spawn(new Ship({ x: 100, y: 100 }))
  const foe = w.spawn(new Ship({ x: 600, y: 400 }))
  foe.damage(90)
  w.spawn(new Bullet({ x: 600, y: 400, owner: me.id }))
  w.step(DT)
  assert.equal(foe.dead, true)
  assert.equal(me.score, 1)
  assert.ok(events.includes('exploded'))
  for (let i = 0; i < 119; i++) w.step(DT)
  assert.equal(foe.dead, true)
  w.step(DT)
  w.step(DT)
  assert.equal(foe.dead, false)
  assert.equal(foe.hp, SHIP_HP)
})

test('великий астероїд розпадається на два менші', () => {
  const w = new World()
  const rock = w.spawn(new Asteroid({ size: 3, x: 300, y: 300 }))
  rock.hp = 1
  w.spawn(new Bullet({ x: 300, y: 300, owner: 0 }))
  w.step(DT)
  const rocks = [...w.ofKind('asteroid')]
  assert.equal(rocks.length, 2)
  assert.ok(rocks.every((r) => r.size === 2))
})

test('pickup дає щит; поки щит — шкоди немає', () => {
  const w = new World()
  const s = w.spawn(new Ship({ x: 300, y: 300 }))
  s.shield = 0
  w.spawn(new Pickup({ x: 300, y: 300, effect: 'shield', duration: 5 }))
  w.step(DT)
  assert.ok(s.shield > 4.9)
  assert.equal(s.damage(50), false)
  assert.equal(s.hp, SHIP_HP)
})

test('homing — той самий компонент на кулі й на астероїді', () => {
  for (const make of [
    () => new Bullet({ x: 100, y: 300, vx: 300, vy: 0, owner: -1, ttl: 5 }),
    () => new Asteroid({ x: 100, y: 300, vx: 300, vy: 0 }),
  ]) {
    const w = new World()
    w.spawn(new Ship({ x: 300, y: 500 })) // ціль нижче
    const e = w.spawn(make())
    e.homing = makeHoming({ turnRate: 3 })
    w.step(DT)
    assert.ok(e.vel.y > 0, `${e.kind} має повернути вниз`)
    assert.ok(Math.abs(e.vel.length() - 300) < 1e-9, 'швидкість зберігається')
  }
})

test('детермінізм: однаковий seed і вхід → однаковий стан', () => {
  const run = () => {
    const w = new World({ seed: 42 })
    w.populate()
    const s = w.spawn(new Ship({ x: 200, y: 360 }))
    for (let i = 0; i < 600; i++) {
      s.controls = { thrust: i % 3 === 0, left: i % 50 < 10, fire: i % 20 === 0 }
      w.step(DT)
    }
    return [...w].map((e) => [e.kind, e.pos.x.toFixed(6), e.pos.y.toFixed(6)]).join('|')
  }
  assert.equal(run(), run())
})
