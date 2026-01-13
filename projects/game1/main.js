const root = document.getElementById('root')
let count = 0

function render() {
  root.innerHTML = `
    <div>
      <p>Score: <strong>${count}</strong></p>
      <button id="inc">+1</button>
      <button id="dec">-1</button>
    </div>
  `
  document.getElementById('inc').onclick = () => { count++; render() }
  document.getElementById('dec').onclick = () => { count--; render() }
}

render()
