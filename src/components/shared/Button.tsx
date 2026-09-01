import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { gameAudio } from '../../game/audio/GameAudio';
import './Button.css';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = 'secondary', className = '', onClick, ...rest }: ButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    gameAudio.unlock();
    gameAudio.play('uiClick');
    onClick?.(event);
  }

  return <button className={`btn btn--${variant} ${className}`.trim()} onClick={handleClick} {...rest} />;
}
