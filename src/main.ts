import '@fontsource/rubik/500.css';
import '@fontsource/rubik/600.css';
import '@fontsource/rubik/700.css';
import '@fontsource/rubik/800.css';
import '@fontsource/rubik/900.css';
import './styles.css';
import { installErrorReporting } from './analytics';
import { App } from './ui/app';

installErrorReporting();
void (document.fonts?.ready ?? Promise.resolve()).finally(() => new App());
