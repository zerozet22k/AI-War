import './TeamColorPicker.css';

/** Small, fixed palette — matches Simulation.ts's DEFAULT_OWNER_COLOR for
 * the first 4 entries so an unconfigured lobby renders exactly as the game
 * always has; a few extras are offered for when two players want visibly
 * different colors within the same team. */
export const COLOR_PALETTE = [
  0x3b82f6, // blue
  0xef4444, // red
  0x22c55e, // green
  0xf59e0b, // amber
  0xa855f7, // purple
  0x06b6d4, // cyan
  0xec4899, // pink
  0xf8fafc, // white
] as const;

const TEAM_NUMBERS = [1, 2, 3, 4] as const;

export interface TeamColorPickerProps {
  team: number;
  onTeamChange: (team: number) => void;
  color: number;
  onColorChange: (color: number) => void;
  /** Colors already claimed by another active slot — offered but disabled. */
  takenColors: number[];
  disabled?: boolean;
}

/** Team assignment is optional, not forced — see PlayerState.team. This
 * picker just exposes team NUMBERS directly: two slots sharing a number are
 * allies, everyone else defaults to their own number (plain free-for-all). */
export function TeamColorPicker({ team, onTeamChange, color, onColorChange, takenColors, disabled = false }: TeamColorPickerProps) {
  return (
    <div className="team-color-picker">
      <div className="team-color-picker__teams" role="group" aria-label="Team">
        {TEAM_NUMBERS.map((n) => (
          <button
            type="button"
            key={n}
            className={`team-color-picker__team${team === n ? ' team-color-picker__team--selected' : ''}`}
            onClick={() => onTeamChange(n)}
            aria-pressed={team === n}
            disabled={disabled}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="team-color-picker__swatches" role="group" aria-label="Color">
        {COLOR_PALETTE.map((swatch) => {
          const takenByOther = takenColors.includes(swatch) && swatch !== color;
          return (
            <button
              type="button"
              key={swatch}
              className={`team-color-picker__swatch${color === swatch ? ' team-color-picker__swatch--selected' : ''}`}
              style={{ backgroundColor: `#${swatch.toString(16).padStart(6, '0')}` }}
              onClick={() => onColorChange(swatch)}
              disabled={disabled || takenByOther}
              aria-pressed={color === swatch}
              aria-label={takenByOther ? 'Already taken' : undefined}
              title={takenByOther ? 'Already taken by another slot' : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
