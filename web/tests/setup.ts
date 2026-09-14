localStorage.setItem('sm_lang', 'zh')
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('sm_lang', 'zh') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) })
Element.prototype.scrollTo = () => {}
