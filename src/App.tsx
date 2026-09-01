import { useEffect } from 'react';
import { useAppStore } from './state/store';
import { MainMenu } from './components/MainMenu/MainMenu';
import { StrategyEditor } from './components/StrategyEditor/StrategyEditor';
import { MatchScreen } from './components/Match/MatchScreen';
import { KeybindEditor } from './components/Match/KeybindEditor';
import { MultiplayerLobby } from './components/Multiplayer/MultiplayerLobby';
import { ApiReferencePage } from './components/ApiReference/ApiReferencePage';
import './App.css';

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const goTo = useAppStore((s) => s.goTo);

  useEffect(() => {
    const guardKey = '__aiWarBackGuard';
    if (!history.state?.[guardKey]) {
      history.replaceState({ ...history.state, __aiWarRoot: true }, '');
      history.pushState({ ...history.state, [guardKey]: true }, '');
    }

    let leavingIntentionally = false;
    let restoringGuard = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (leavingIntentionally) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onBack = () => {
      if (leavingIntentionally) return;
      if (restoringGuard) {
        restoringGuard = false;
        return;
      }
      const confirmed = window.confirm('Leave AEVRA? Unsaved code or the current match may be lost.');
      if (confirmed) {
        leavingIntentionally = true;
        window.removeEventListener('beforeunload', beforeUnload);
        history.back();
      } else {
        restoringGuard = true;
        history.forward();
      }
    };

    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', onBack);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('popstate', onBack);
    };
  }, []);

  return (
    <div className="app">
      {screen === 'menu' && <MainMenu />}
      {screen === 'strategyEditor' && <StrategyEditor />}
      {screen === 'match' && <MatchScreen />}
      {screen === 'settings' && <KeybindEditor onClose={() => goTo('menu')} />}
      {screen === 'multiplayerLobby' && <MultiplayerLobby />}
      {screen === 'apiReference' && <ApiReferencePage />}
    </div>
  );
}
