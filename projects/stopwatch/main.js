const display = document.getElementById('display')
const startStop = document.getElementById('startStop')
const reset = document.getElementById('reset')
const result = document.getElementById('result')

let startTime = 0
let running = false
let raf = null

function format(ms) {
  return (ms / 1000).toFixed(3)
}

function tick() {
  const now = performance.now()
  const elapsed = now - startTime
  display.textContent = format(elapsed)
  raf = requestAnimationFrame(tick)
}

function start() {
  startTime = performance.now()
  running = true
  startStop.textContent = 'Stop'
  result.textContent = ''
  raf = requestAnimationFrame(tick)
}

function stop() {
  if (!running) return
  running = false
  cancelAnimationFrame(raf)
  const elapsed = performance.now() - startTime
  display.textContent = format(elapsed)
  startStop.textContent = 'Start'
  checkResult(elapsed)
}

function resetAll() {
  if (raf) cancelAnimationFrame(raf)
  running = false
  startStop.textContent = 'Start'
  display.textContent = '0.000'
  result.textContent = ''
}

function checkResult(ms) {
  const target = 5000 // ms
  const diff = ms - target
  const abs = Math.abs(diff)
  if (abs <= 100) {
    result.innerHTML = `<span class="success">Nice! ${format(ms)} (diff ${ (diff/1000).toFixed(3)}s )</span>`
  } else {
    result.innerHTML = `<span class="fail">Close: ${format(ms)} (diff ${ (diff/1000).toFixed(3)}s )</span>`
  }
}

startStop.addEventListener('click', () => {
  if (running) stop()
  else start()
})

reset.addEventListener('click', resetAll)

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    if (running) stop()
    else start()
  }
  if (e.key === 'r') resetAll()
})
