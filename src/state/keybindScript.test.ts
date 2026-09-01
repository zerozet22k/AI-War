import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBIND_SCRIPT, compileKeybinds, findKeyForAction, formatKeyCode, isReservedUiAction, normalizeKeyName } from './keybindScript';

describe('normalizeKeyName', () => {
  it('maps digits and letters to KeyboardEvent.code values', () => {
    expect(normalizeKeyName('1')).toBe('Digit1');
    expect(normalizeKeyName('k')).toBe('KeyK');
    expect(normalizeKeyName('K')).toBe('KeyK');
    expect(normalizeKeyName('space')).toBe('Space');
  });

  it('rejects unknown key names', () => {
    expect(normalizeKeyName('F1')).toBeNull();
    expect(normalizeKeyName('!!')).toBeNull();
  });

  it('reserves escape for the pause menu — it can never be bound to anything else', () => {
    expect(normalizeKeyName('escape')).toBeNull();
    expect(normalizeKeyName('esc')).toBeNull();
  });
});

describe('compileKeybinds', () => {
  it('compiles the default script into the expected bindings', () => {
    const result = compileKeybinds(DEFAULT_KEYBIND_SCRIPT);
    expect(result.errors).toHaveLength(0);
    expect(result.bindings).toEqual({
      KeyK: 'toggle_settings',
      KeyE: 'toggle_strategy_editor',
    });
  });

  it('reports a syntax error without throwing', () => {
    const result = compileKeybinds('bind("1", "attack_now"');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.bindings).toEqual({});
  });

  it('accepts an arbitrary action name — it is validated as a script function only when the key is pressed', () => {
    const result = compileKeybinds('bind("1", "myCustomFunction");');
    expect(result.errors).toHaveLength(0);
    expect(result.bindings).toEqual({ Digit1: 'myCustomFunction' });
  });

  it('reports an unknown key name as a runtime error', () => {
    const result = compileKeybinds('bind("F1", "skip");');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/unknown key name/i);
  });

  it('lets a later bind() overwrite an earlier one for the same key', () => {
    const result = compileKeybinds('bind("1", "attack_now"); bind("1", "skip");');
    expect(result.errors).toHaveLength(0);
    expect(result.bindings.Digit1).toBe('skip');
  });
});

describe('isReservedUiAction', () => {
  it('flags only the built-in UI actions, not script function names', () => {
    expect(isReservedUiAction('toggle_settings')).toBe(true);
    expect(isReservedUiAction('toggle_strategy_editor')).toBe(true);
    expect(isReservedUiAction('rush')).toBe(false);
  });
});

describe('findKeyForAction / formatKeyCode', () => {
  it('finds the key bound to a given action and formats it for display', () => {
    const { bindings } = compileKeybinds(DEFAULT_KEYBIND_SCRIPT);
    const key = findKeyForAction(bindings, 'toggle_settings');
    expect(key).toBe('KeyK');
    expect(formatKeyCode(key!)).toBe('K');
    expect(findKeyForAction(bindings, 'not_bound')).toBeNull();
  });
});
