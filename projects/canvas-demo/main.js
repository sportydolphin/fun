const canvas = document.getElementById('c')
const ctx = canvas.getContext('2d')
let x = 50
let dir = 1

function frame() {
  ctx.clearRect(0,0,canvas.width,canvas.height)
  ctx.fillStyle = '#ff6'
  ctx.beginPath()
  ctx.arc(x, canvas.height/2, 30, 0, Math.PI*2)
  ctx.fill()
  x += dir * 2
  if (x > canvas.width - 30 || x < 30) dir *= -1
  requestAnimationFrame(frame)
}

frame()
