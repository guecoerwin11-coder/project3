// Dark mode on/off.
// No saved choice: follow the device (prefers-color-scheme). After the user flips the
// switch, <html data-theme="dark|light"> overrides the device; styles.css reads both.
// The saved choice is applied by a tiny script in index.html before the page draws,
// so a dark-mode user never sees a white flash.

const KEY = 'skillbridge.theme'
const deviceDark = window.matchMedia('(prefers-color-scheme: dark)')

const savedTheme = () => {
    try{
        const v = localStorage.getItem(KEY)
        return v === 'dark' || v === 'light' ? v : null
    }catch{
        return null // storage blocked (private mode): fall back to the device setting
    }
}

export const isDark = () => (document.documentElement.dataset.theme ?? (deviceDark.matches ? 'dark' : 'light')) === 'dark'

const syncToggles = () => {
    const dark = isDark()
    document.querySelectorAll('.theme-toggle').forEach(b => {
        b.setAttribute('aria-checked', String(dark))
        b.title = dark ? 'Switch to light mode' : 'Switch to dark mode'
    })
}

export const setTheme = (theme) => {
    document.documentElement.dataset.theme = theme
    try{ localStorage.setItem(KEY, theme) }catch{ /* still applies for this visit */ }
    syncToggles()
}

export const toggleTheme = () => setTheme(isDark() ? 'light' : 'dark')

export const installTheme = () => {
    // Device switched (e.g. phone at sunset) and the user never chose: follow it
    deviceDark.addEventListener('change', () => { if(!savedTheme()) syncToggles() })
}

const SUN = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 1.5v2.5M12 20v2.5M1.5 12H4M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></g></svg>'
const MOON = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="currentColor"/></svg>'

// A switch: role + aria-checked tell screen readers it is on/off; Enter/Space work natively
export const themeToggle = (extraClass = '') => {
    const dark = isDark()
    return `
    <button type="button" class="theme-toggle ${extraClass}" role="switch" aria-checked="${dark}" aria-label="Dark mode" data-action="toggle-theme"
        title="${dark ? 'Switch to light mode' : 'Switch to dark mode'}">
        <span class="track" aria-hidden="true"><span class="knob"><span class="sun">${SUN}</span><span class="moon">${MOON}</span></span></span>
        <span class="label">Dark mode</span>
    </button>`
}
