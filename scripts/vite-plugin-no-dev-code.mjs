// Fail the production build if any code from src/dev/ survives into the bundle.
//
// src/dev/ holds the dev menu, the MLB simulators, the fake admin roster and the slow-load
// switches. Each is kept out of production only by an `import.meta.env.DEV` gate at its call
// site, which the build replaces with `false` so the code tree-shakes away. Nothing checked that:
// on Oct 7, 2026 the MLB simulators were found shipping to every reader because one gate had gone
// missing, and it was found only because someone happened to grep the built output.
//
// The bundler records how many bytes of each module it actually rendered, so a module that tree-shook
// away reports zero. Anything above a small floor is real code: the floor allows what a gated
// module unavoidably leaves behind (slowLoad.ts exports a constant 0 that main.tsx still reads).

const FLOOR_BYTES = 64

// Rolldown (Vite 8) wraps every module in `//#region` / `//#endregion` comments and counts them in
// renderedLength, about 45 bytes of nothing per module, so measure the code without them.
const codeLength = info => info.code == null
  ? info.renderedLength
  : info.code.replace(/^\/\/#(end)?region.*$/gm, '').trim().length

export function noDevCode() {
  return {
    name: 'no-dev-code',
    apply: 'build',
    generateBundle(_options, bundle) {
      const leaks = []
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const [id, info] of Object.entries(chunk.modules)) {
          if (!/[\\/]src[\\/]dev[\\/]/.test(id)) continue
          const size = codeLength(info)
          if (size > FLOOR_BYTES) leaks.push(`${id.replace(/^.*[\\/]src[\\/]/, 'src/')} (${size} bytes in ${chunk.fileName})`)
        }
      }
      if (leaks.length) {
        this.error(`Dev-only code reached the production bundle. Gate its call site behind import.meta.env.DEV:\n  ${leaks.join('\n  ')}`)
      }
    },
  }
}
