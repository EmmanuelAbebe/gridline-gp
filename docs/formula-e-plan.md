# Car classes, step 2: Formula E (Gen3 Evo)

Asked 2026-11-07 (user: "start the formula E step"). Their picks: the **Gen3 Evo** (today's car), a **whole-race energy
budget** (the battery is the race, as the real thing), **physics first**: this step is the car's physics, AI and tests,
driven through a debug switch; the class picker (clickable mock-ups on a canvas first, as the user wants for any new
design) and a Formula E-shaped 3D model come after it. The F1 stays bit-identical at every stage (sim-trace, car-bench).

## The real car (sources at the end; ~ = our estimate where no figure was published)

| | Gen3 Evo | how we model it |
|---|---|---|
| Mass | 840 kg with driver (760 + 80) | `car.mass` 840 |
| Power | 350 kW (qualifying, attack mode), 300 kW race mode | motor map: constant torque to its base speed, then constant power; race 300 / attack 350 |
| Drive | rear motor 350 kW; the front unit (250 kW) also drives at the start, in qualifying and in attack mode (AWD) | front drive in chassis.js when the car's front motor is on |
| 0–60 mph | 1.82 s (AWD) | car-bench range |
| Top speed | 322 km/h theoretical; ~290–300 at the end of street straights | one gear, top ~320 km/h; drag area ~0.8 m² (350 kW at 322 km/h) |
| Gearbox | single speed (teams' own; not in the sources found) | gearbox with one gear, no shifting |
| Regeneration | 600 kW: 350 rear + 250 front | the brakes: regen first, front hydraulics for the rest |
| Rear brakes | none (no rear hydraulic brakes): the rear motor's regen only | rear braking capped by the rear motor's power (weak at high speed): brake-by-wire balance |
| Battery | 38.5 kWh usable in a race; ~40 % of race energy from regen | `energy` = the race's allowance, sized to its distance; regen adds back |
| Tyres | Hankook iON all-weather (grooved), no warmers, one compound for the race; Evo +5–10 % grip | grip ~1.4 (vs F1 slicks 1.8), wider temperature window starting from air temperature, very low wear |
| Downforce | low (a fraction of F1's) | lift area ~1.6 m²: downforce = weight at ~330 km/h (F1 ~185) |
| Size | ~5.0 m long, 1.7 m wide | wheelbase ~2.97 m, track ~1.5 m, own hitbox |

## Stages (each: F1 sim-trace identical, car-bench the same; the new class measured against the table)

1. **The class and its electric powertrain.** (Done 2026-11-07: grip 1.55 for a real launch (1.45 gave 0–60 mph 3.4 s),
   frontWeight 0.43; the class is `ranked: false` until finished; the engine sound is still the F1's V6.) `classes/fe-gen3evo.js` (`FE_GEN3_EVO`, id `fe`): the numbers above;
   `power.type` 'electric' with a `motor` table (torque, base and max rpm, race / attack kW, efficiency). vehicle.js
   drivetrain → an electric branch: one gear, motor rpm for the dash and sound, the drive drawn from the battery
   (J, efficiency), no engine braking or shift cut; the hybrid branch untouched. `npm run car-bench -- --class=fe` with
   the real ranges (0–60 mph, top speed).
2. **Brakes = regeneration.** (Done 2026-11-07: 280 → 80 km/h 158 m, peak 2.03 g; regen ≤ 540 kW at the battery;
   31–49 % of a lap's energy back; the AI plans with the weaker rear.) Per axle: the motors' regen (rear 350 / front 250 kW: force = P / v) first, the front
   hydraulics for the rest, no rear hydraulics; lifting harvests a little. The battery gains what is regenerated. Locking
   without ABS as now. Measured: 300 → 80 km/h distance, the rear's share falling at speed.
3. **Whole-race energy.** createRace sizes the battery to the race (energy per lap × laps, from a real allowance:
   38.5 kWh over a ~45 min race); empty = the car coasts. The HUD: energy left vs laps left (and a target per lap). The
   ECU maps become Formula E's (race 300 kW, lift-and-coast before braking points by how much energy is short); the AI
   manages its energy the same way (it must finish, and not with half a battery).
4. **Attack mode and the start.** 350 kW + AWD for its minutes, taken by driving through an activation zone off the
   racing line (the player: a button or automatic; the AI: when it is safe), AWD launch at the start.
5. **Tyres and wear.** All-weather tyres: lower grip and load sensitivity, temperature from the air with no blankets,
   a wide window, very little wear; no pit stops (the pit lane stays for drive-throughs; Pit Boost charging later).
6. **The AI on it.** Its own racing lines (`npm run lap-optimum -- <id> --class=fe --write-line`), its paces, feel and
   margins (`ai` of the class); full-field Formula E races clean on every circuit; ALIEN levels rescanned.
7. **Driving it now:** a debug switch (`gridlineDebug.carClass('fe')`, `GRIDLINE_SMOKE_CLASS=fe` for a smoke run).

After this step: the class picker (mock-ups on a canvas first), the Formula E 3D model, attack mode on the phone wheel.

## Open questions

- Its name in the game (no real teams, drivers or circuits): the class's name will need an invented one before a menu
  shows it.
- Street circuits: Formula E races on tight street tracks; ours are wider road courses (Cobalt Bay is the closest).

## Sources

FIA / Formula E: GEN3 explained (fiaformulae.com/en/news/487147), GEN3 Evo (fia.com news "Formula E and FIA unveil
GEN3 Evo"; fiaformulae.com/en/news/500924); Wikipedia "Formula E Gen3" (mass, battery 38.5 kWh, 322 km/h, 600 kW regen);
Autosport "Formula E Gen3: what is it and what is new" (no rear brakes); The Race "Everything you need to know about
Formula E's new Gen3 Evo car", "Why overtakings got harder in Formula E Gen3" (regen, lifting); Motorsport Magazine
(40 % of race energy from regen).
