import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
// The font files come with the site, like in the app: Open Sans text, Nunito headings, Roboto Mono code.
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/roboto-mono/400.css';
import './chatter.css';
import HeroLogo from './HeroLogo.vue';

// The default theme, with the Chatter colors and the Chatter by Toolpath wordmark at the top of the home page.
export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'home-hero-info-before': () => h(HeroLogo) }),
};
