/**
 * Shared concierge chat palette (shre-chat style). ArosChat and the data
 * canvas both theme off these so the panel matches the chat, not the
 * dashboard's --aros-color-* vars. Theme is picked by sniffing the whitelabel
 * background, same rule the chat has always used.
 */
import { useWhitelabel } from '../whitelabel/WhitelabelProvider';

export const SC_DARK = {
  bg1: '#0d0d0f', bg2: '#161618', bg3: '#1e1e22',
  bgInput: 'rgba(255,255,255,0.06)', bgHover: 'rgba(255,255,255,0.06)',
  msgUser: 'rgba(99,141,255,0.10)', msgAi: 'rgba(255,255,255,0.045)',
  text1: '#ececf1', text2: '#a1a1aa', text3: '#6b6b76',
  border1: 'rgba(255,255,255,0.1)', border2: 'rgba(255,255,255,0.065)',
  accent: '#638dff', accentSoft: 'rgba(99,141,255,0.14)',
};

export const SC_LIGHT = {
  bg1: '#f5f5f7', bg2: '#ffffff', bg3: '#eeeef0',
  bgInput: 'rgba(0,0,0,0.04)', bgHover: 'rgba(0,0,0,0.05)',
  msgUser: 'rgba(79,110,220,0.09)', msgAi: 'rgba(0,0,0,0.035)',
  text1: '#1a1a1e', text2: '#52525b', text3: '#71717a',
  border1: 'rgba(0,0,0,0.12)', border2: 'rgba(0,0,0,0.08)',
  accent: '#4f6edc', accentSoft: 'rgba(79,110,220,0.10)',
};

export type ChatTheme = typeof SC_DARK;

export function useChatTheme(): ChatTheme {
  const { config } = useWhitelabel();
  const bg = (config.theme?.colors?.background || '#ffffff').toLowerCase();
  const isLight = bg === '#ffffff' || bg === '#fff' || bg.startsWith('rgb(255');
  return isLight ? SC_LIGHT : SC_DARK;
}
