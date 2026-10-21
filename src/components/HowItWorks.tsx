import { GAME_MODES } from '../game/modes'
import { useGameStore } from '../state/gameStore'
import { FLIGHT_BINDINGS, VIEW_BINDINGS, type Binding } from './controlsData'

function BindingTable({ caption, rows }: { caption: string; rows: readonly Binding[] }) {
  return (
    <table className="controls-table">
      <caption>{caption}</caption>
      <tbody>
        {rows.map((b) => (
          <tr key={b.action}>
            <th scope="row">{b.action}</th>
            <td>
              <kbd>{b.keys}</kbd>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Beginner's guide: how the aircraft flies, the controls, the HUD and the modes. */
export function HowItWorks() {
  const closeOverlay = useGameStore((s) => s.closeOverlay)
  return (
    <div className="screen screen-center scrim overlay" role="dialog" aria-modal="true" aria-label="How it works">
      <div className="panel dialog-panel guide-panel">
        {/* Focus the heading, not the bottom button, so the guide opens at the top. */}
        <h2 tabIndex={-1} autoFocus>
          How it works
        </h2>

        <section className="guide-section">
          <h3>Your first flight</h3>
          <ol className="guide-steps">
            <li>
              <strong>Power up.</strong> Hold <kbd>R</kbd> to push the throttle to 100%. The engine takes a second or
              two to spool up, and you will hear it rise.
            </li>
            <li>
              <strong>Roll straight.</strong> Steer on the runway with the rudder, <kbd>Q</kbd> / <kbd>E</kbd>, to stay on
              the centreline.
            </li>
            <li>
              <strong>Rotate.</strong> At about 55 kt, hold <kbd>S</kbd> gently to lift the nose about 8 degrees. The
              aircraft will fly itself off the ground.
            </li>
            <li>
              <strong>Climb.</strong> Keep the nose 5 to 10 degrees up at around 70 kt. Use trim (<kbd>.</kbd> /{' '}
              <kbd>,</kbd>) so you do not have to hold the stick.
            </li>
            <li>
              <strong>Turn.</strong> Bank with <kbd>A</kbd> / <kbd>D</kbd>, then add a little back pressure (<kbd>S</kbd>)
              to keep the nose from dropping. Level the wings to stop turning.
            </li>
          </ol>
        </section>

        <section className="guide-section">
          <h3>What keeps you in the air</h3>
          <ul>
            <li>
              <strong>Speed makes lift.</strong> Below about 52 kt with flaps up, the wing stalls. A horn sounds and{' '}
              <em>STALL</em> flashes before that happens. To recover, lower the nose and add power.
            </li>
            <li>
              <strong>Pitch sets speed, power sets climb.</strong> Nose down to gain speed, nose up to slow down. More
              throttle at the same speed means a climb, less means a descent.
            </li>
            <li>
              <strong>Flaps</strong> (<kbd>X</kbd> extend, <kbd>Z</kbd> retract) add lift and drag. They let you fly
              slower for take-off and landing.
            </li>
            <li>
              <strong>Controls get softer at low speed</strong>, because there is less air flowing over them.
            </li>
          </ul>
        </section>

        <section className="guide-section">
          <h3>Landing</h3>
          <ul>
            <li>Line up with the runway early, set flaps, and slow to about 65 kt.</li>
            <li>Aim for a steady descent of about 500 ft/min towards the white touchdown markers.</li>
            <li>Just above the runway, cut the power (<kbd>F</kbd>) and gently raise the nose to flare.</li>
            <li>
              Touch down softly. More than about 900 ft/min is a crash. Then hold <kbd>B</kbd> to brake to a stop.
            </li>
            <li>A wingtip, the tail or the propeller touching the ground ends the flight.</li>
          </ul>
        </section>

        <section className="guide-section">
          <h3>Reading the screen</h3>
          <ul>
            <li>
              <strong>Left box:</strong> airspeed, ground speed, angle of attack and G load.
            </li>
            <li>
              <strong>Right box:</strong> altitude, height above ground near the surface, vertical speed, pitch and
              bank.
            </li>
            <li>
              <strong>Engine box:</strong> throttle, rpm, flaps, brakes and trim.
            </li>
            <li>
              <strong>Top:</strong> heading tape and your current objective with its progress.
            </li>
            <li>
              <strong>Top right:</strong> a minimap of nearby airports and the nearest airport's distance and
              bearing. Press <kbd>M</kbd> for the full island map.
            </li>
            <li>
              <strong>Approach guidance:</strong> when you line up with a runway, two scales show how far you are
              from the centreline (horizontal) and the 3 degree glide path (vertical). Keep both diamonds centred.
            </li>
            <li>
              <strong>Bottom left:</strong> the key commands.
            </li>
            <li>
              <strong>Instrument panel:</strong> airspeed, attitude, altimeter, rpm, heading and vertical speed, like
              a real cockpit.
            </li>
          </ul>
        </section>

        <section className="guide-section">
          <h3>Controls</h3>
          <BindingTable caption="Flying" rows={FLIGHT_BINDINGS} />
          <BindingTable caption="View and game" rows={VIEW_BINDINGS} />
          <p className="note">In free camera mode, drag with the mouse to look around and scroll to zoom.</p>
        </section>

        <section className="guide-section">
          <h3>Game modes</h3>
          <ul>
            {GAME_MODES.map((m) => (
              <li key={m.id}>
                <strong>{m.name}:</strong> {m.tagline}.
              </li>
            ))}
          </ul>
        </section>

        <section className="guide-section">
          <h3>Sound</h3>
          <p>
            You will hear the engine follow the throttle and rpm, wind rise with speed and tyres rumble on the
            runway. There are also flap motors, a thump and squeal at touchdown, the stall horn, chimes for each
            ring and the crash. Set the volume in Settings.
          </p>
        </section>

        <div className="menu-buttons row">
          <button type="button" className="btn primary" onClick={closeOverlay}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
