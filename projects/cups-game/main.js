function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function randFloat(min, max) { return Math.random() * (max - min) + min }

function makeCup() {
  const width = rand(80, 160)
  const height = rand(140, 300)
  const fill = Math.round(randFloat(0.08, 0.96) * 100) / 100
  // compute 'water volume' as area * fill
  const water = width * height * fill
  return { width, height, fill, water }
}

const leftSlot = document.getElementById('left')
const rightSlot = document.getElementById('right')
const streakEl = document.getElementById('streak')
const msg = document.getElementById('message')
const restartBtn = document.getElementById('restart')

let streak = 0
let current = null

function renderCup(cup) {
  const card = document.createElement('div')
  card.className = 'cup-card'
  const cupEl = document.createElement('div')
  cupEl.className = 'cup'
  cupEl.style.width = cup.width + 'px'
  cupEl.style.height = cup.height + 'px'
  const water = document.createElement('div')
  water.className = 'water'
  water.style.height = (cup.fill * 100) + '%'
  cupEl.appendChild(water)
  const label = document.createElement('div')
  label.className = 'label'
  label.textContent = `${Math.round(cup.fill * 100)}% filled` 
  card.appendChild(cupEl)
  card.appendChild(label)
  return card
}

function pickPair() {
  let a = makeCup()
  let b = makeCup()
  // avoid exact ties (very unlikely but possible)
  if (Math.abs(a.water - b.water) < 1) return pickPair()
  return [a, b]
}

function showPair() {
  const [a, b] = pickPair()
  current = { a, b }
  leftSlot.innerHTML = ''
  rightSlot.innerHTML = ''
  const leftCard = renderCup(a)
  const rightCard = renderCup(b)
  leftSlot.appendChild(leftCard)
  rightSlot.appendChild(rightCard)
  leftSlot.classList.remove('correct','wrong')
  rightSlot.classList.remove('correct','wrong')
  msg.textContent = ''
}

function endRound(correct) {
  if (correct) {
    streak++
    streakEl.textContent = streak
    msg.textContent = 'Correct — next pair!'
    setTimeout(showPair, 700)
  } else {
    msg.textContent = `Wrong — final streak ${streak}. Click Restart to try again.`
  }
}

function handleChoice(side) {
  if (!current) return
  const chosen = side === 'left' ? current.a : current.b
  const other = side === 'left' ? current.b : current.a
  const correct = chosen.water > other.water
  // visual feedback
  if (correct) {
    const slot = side === 'left' ? leftSlot : rightSlot
    slot.classList.add('correct')
  } else {
    const slot = side === 'left' ? leftSlot : rightSlot
    slot.classList.add('wrong')
    // also mark the correct one
    const correctSlot = side === 'left' ? rightSlot : leftSlot
    correctSlot.classList.add('correct')
  }
  if (!correct) {
    // game over, reset current so input ignored until restart
    current = null
    return endRound(false)
  }
  endRound(true)
}

leftSlot.addEventListener('click', () => handleChoice('left'))
rightSlot.addEventListener('click', () => handleChoice('right'))

// keyboard shortcuts 1 and 2
window.addEventListener('keydown', (e) => {
  if (!current) return
  if (e.key === '1') handleChoice('left')
  if (e.key === '2') handleChoice('right')
})

restartBtn.addEventListener('click', () => {
  streak = 0
  streakEl.textContent = streak
  showPair()
})

// init
showPair()
