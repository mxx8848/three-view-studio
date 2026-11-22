// This tiny independent script still reports a failure if app.js or one of its
// dependencies never loads, leaving the native file picker otherwise silent.
if(location.protocol==='file:') {
  // A file URL cannot load this site's ES modules or call its local API.
  // Show the correct entry before the user tries the native file picker.
  const notice=document.createElement('div');
  notice.id='localFileNotice';notice.className='upload-import-status has-error';notice.setAttribute('role','alert');
  const message=document.createElement('span');
  message.textContent='当前是直接打开的 HTML 文件，上传和建模无法运行。请先在项目目录运行 npm start，再打开本地网站：';
  const link=document.createElement('a');link.href='http://127.0.0.1:5178/';link.textContent='打开三视图工坊';link.className='primary';
  notice.append(message,link);document.querySelector('main').prepend(notice);
  document.querySelector('#fileInput').disabled=true;
  document.querySelector('#cameraInput').disabled=true;
  document.querySelector('#dropZone .drop-main').textContent='请先点击上方「打开三视图工坊」';
}

for(const input of document.querySelectorAll('#fileInput, #cameraInput')) input.addEventListener('change',()=>{
  if(input.dataset.uploadReady==='true'||!input.files?.length)return;
  const status=document.querySelector('#uploadImportStatus');
  status.hidden=false;status.classList.add('has-error');
  status.querySelector('span').textContent='上传组件尚未加载成功，请刷新页面后重试。若仍失败，请检查本地服务是否正在运行。';
  const button=document.querySelector('#uploadCancelImport');button.textContent='关闭提示';button.onclick=()=>{status.hidden=true;};
});
