import './styles.css'

const app = document.getElementById('app')

const projects = [
  { name: 'Cups Compare', path: '/projects/cups-game/' },
  { name: 'Stopwatch (stop at 5s)', path: '/projects/stopwatch/' }
]

function createButton(p) {
  const btn = document.createElement('button')
  btn.className = 'project-btn'
  btn.type = 'button'
  btn.textContent = p.name
  btn.setAttribute('aria-label', `Open ${p.name}`)
  btn.addEventListener('click', () => { window.location.href = p.path })
  return btn
}

if (app) {
  app.innerHTML = `
    <h1>sportydolphin.fun</h1>
    <p>Select a project:</p>
    <div class="projects" role="list"></div>
  `
  const container = app.querySelector('.projects')
  projects.forEach(p => container.appendChild(createButton(p)))
}
