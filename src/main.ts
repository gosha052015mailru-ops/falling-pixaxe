import '@fontsource/tiny5/400.css';
import '@fontsource/press-start-2p/400.css';
import './styles.css';
import { App } from './ui/app';

void (document.fonts?.ready ?? Promise.resolve()).finally(() => new App());
