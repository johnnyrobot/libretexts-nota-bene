// Keyboard alternative: the user explicitly chooses a real paragraph, then NB opens its editor.
(() => {
  const main = document.querySelector('#main-content');
  if (!main) return;
  const paragraphs = [...main.querySelectorAll('p')].filter(p => p.textContent.trim());
  const section = document.createElement('section'); section.className='nb-book-controls';
  section.setAttribute('aria-label','Discuss a textbook passage');
  const label=document.createElement('label'); label.textContent='Choose a passage to discuss';
  const select=document.createElement('select'); select.id='nb-book-passage';label.htmlFor=select.id;
  paragraphs.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${i+1}. ${p.textContent.trim().slice(0,100)}`;select.append(o);});
  const button=document.createElement('button');button.type='button';button.textContent='Discuss selected passage';
  const help=document.createElement('p');help.textContent='Sign in to Nota Bene to discuss with your course. You can also select text directly in the reading.';
  button.addEventListener('click',()=>{
    const p=paragraphs[Number(select.value)];if(!p?.isConnected)return;
    p.scrollIntoView({block:'center'});
    const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);
    const nodes=[];while(walker.nextNode())if(walker.currentNode.textContent.length)nodes.push(walker.currentNode);
    if(!nodes.length)return;
    const range=document.createRange();range.setStart(nodes[0],0);range.setEnd(nodes[nodes.length-1],nodes[nodes.length-1].length);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    document.body.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
    requestAnimationFrame(() => document.querySelector('#nb-app .editor-view .ql-editor')?.focus());
  });
  section.append(label,select,button,help);main.before(section);
})();
