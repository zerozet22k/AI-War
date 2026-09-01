import type { RaceId } from '../../types/game';
import { RACE_ID_LIST } from '../../types/game';
import { RACES } from '../../game/races';
import { raceEmblemUrl } from '../../game/raceVisuals';
import './RacePicker.css';

export interface RacePickerProps {
  label: string;
  value: RaceId;
  onChange: (race: RaceId) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function RacePicker({ label, value, onChange, disabled = false, compact = false }: RacePickerProps) {
  return (
    <fieldset className={`race-picker${compact ? ' race-picker--compact' : ''}`} disabled={disabled}>
      <legend>{label}</legend>
      <div className="race-picker__options">
        {RACE_ID_LIST.map((raceId) => {
          const race = RACES[raceId];
          return (
            <button
              type="button"
              key={raceId}
              className={`race-picker__card${value === raceId ? ' race-picker__card--selected' : ''}`}
              onClick={() => onChange(raceId)}
              aria-pressed={value === raceId}
            >
              <span className="race-picker__portrait">
                <img src={raceEmblemUrl(raceId)} alt="" aria-hidden="true" draggable={false} />
              </span>
              <span className="race-picker__copy">
                <strong>{race.name}</strong>
                <small>{race.tagline}</small>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
