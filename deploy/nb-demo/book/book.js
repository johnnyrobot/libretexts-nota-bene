// Primary way to discuss a passage is selecting text directly, which the NB panel itself handles.
// This section is the keyboard alternative for paragraphs that are hard to drag-select, so it stays
// collapsed by default behind a disclosure, matching the equivalent control already shipped at
// library.libretexts.dev ("Expand Choose a passage with the keyboard").
(() => {
  const main = document.querySelector('#main-content');
  if (!main) return;
  const paragraphs = [...main.querySelectorAll('p')].filter(p => p.textContent.trim());
  const details = document.createElement('details'); details.className='nb-book-controls';
  const summary = document.createElement('summary'); summary.textContent='Choose a passage with the keyboard';
  const label=document.createElement('label'); label.textContent='Choose a passage to discuss';
  const select=document.createElement('select'); select.id='nb-book-passage';label.htmlFor=select.id;
  paragraphs.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${i+1}. ${p.textContent.trim().slice(0,100)}`;select.append(o);});
  const button=document.createElement('button');button.type='button';button.textContent='Discuss selected passage';
  const help=document.createElement('p');help.setAttribute('role','status');
  const signedInIdleHelp='Choose a passage above, then Discuss selected passage to open the NB editor.';
  const signedOutIdleHelp='Sign in to Nota Bene in the panel to discuss with your course. You can also select text directly in the reading.';
  const readerIdleHelp='Exit Reader Mode to discuss passages. Your NB discussions remain saved.';
  const idleHelp=()=>document.documentElement.dataset.ttsReader==='on'
    ? readerIdleHelp
    : (document.documentElement.dataset.nbSignedIn==='true' ? signedInIdleHelp : signedOutIdleHelp);
  help.textContent=idleHelp();
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
  details.append(summary,label,select,button);help.className='nb-book-status';main.before(details,help);
  document.addEventListener('nb-anchor-unavailable',()=>{help.textContent='A discussion cannot be anchored to this exact publication. Its saved record is preserved.';});
  document.addEventListener('click',event=>{
    if(!event.target.closest('#tts-enter'))return;
    const editor=document.querySelector('#nb-app .editor-view');
    if(editor && editor.getClientRects().length && getComputedStyle(editor).visibility!=='hidden'){
      event.preventDefault();event.stopImmediatePropagation();help.textContent='Save or cancel your NB comment before entering Reader Mode.';
    }
  },true);
  const restoreKey='nb.book.return';
  try{const saved=JSON.parse(sessionStorage.getItem(restoreKey)||'null');if(saved && saved.page===location.pathname && Number.isFinite(saved.y) && saved.y>=0){sessionStorage.removeItem(restoreKey);requestAnimationFrame(()=>{window.scrollTo(0,saved.y);main.focus({preventScroll:true});});}}catch{}
  let reading=document.documentElement.dataset.ttsReader==='on';
  new MutationObserver(()=>{
    const active=document.documentElement.dataset.ttsReader==='on';button.disabled=active;select.disabled=active;
    help.textContent=idleHelp();
    if(reading && !active){
      document.documentElement.dataset.nbReaderRestoring='true';
      try{sessionStorage.setItem(restoreKey,JSON.stringify({page:location.pathname,y:window.scrollY}));}catch{}
      location.reload();
    }
    reading=active;
  }).observe(document.documentElement,{attributes:true,attributeFilter:['data-tts-reader','data-nb-signed-in']});
})();
