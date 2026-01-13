import './styles.css'

const app = document.getElementById('app')

if (app) {
  app.innerHTML = `
    <h1>sportydolphin.fun</h1>
    <p>Select a project:</p>
    <ul>
      <li><a href="/projects/game1/">Game 1</a></li>
      <li><a href="/projects/game2/">Game 2</a></li>
      <li><a href="/projects/canvas-demo/">Canvas Demo</a></li>
    </ul>
  `
}
