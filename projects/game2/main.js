const box = document.getElementById('box')
function randColor() { return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0') }
box.addEventListener('click', () => { box.style.background = randColor() })
