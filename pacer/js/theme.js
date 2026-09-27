// Colour themes. Every theme keeps a black background and the brightest colours for text,
// because the phone is read in sunlight. The CSS side (text, buttons, your arrow) lives in
// app.css under :root[data-theme=...]; the map side is here.
//   line   the course from the ghost onward (bright)
//   route  the course behind the ghost (thin)
//   km*, ends   km markers, START/FINISH labels (aid stations and bars are always
//                black and white)
export const THEMES = {
  mono: {
    label: 'B&W',
    line: '#FFFFFF', route: '#8A8A8A',
    kmFill: '#000000', kmStroke: '#FFFFFF', kmText: '#FFFFFF', ends: '#FFFFFF',
  },
  amber: {
    label: 'Amber',
    line: '#FFD60A', route: '#8C7A26',
    kmFill: '#000000', kmStroke: '#FFD60A', kmText: '#FFD60A', ends: '#FFD60A',
  },
};

export const THEME_ORDER = ['mono', 'amber'];

export const THEME_NOTES = {
  mono: 'White on black, one yellow accent: your arrow. Most contrast in sunlight.',
  amber: 'Everything in one warm yellow.',
};

// (Ice and Signal were removed: anyone on them goes back to B&W.)
export function themeName(name) { return THEMES[name] ? name : 'mono'; }
export function themeOf(name) { return THEMES[themeName(name)]; }

export function applyTheme(name) {
  document.documentElement.dataset.theme = themeName(name);
}
