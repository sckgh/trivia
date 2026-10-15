import '@fontsource/bebas-neue/400.css';
import '@fontsource-variable/montserrat/wght.css';
import { render } from 'preact';
import { App } from './App';
import './display.css';

render(<App />, document.getElementById('app')!);
