const scenarios = {
  documents: { kind: '文档写作', title: '把零散资料，\n写成一份好文档。', description: '整理材料、梳理结构、起草内容。让思路落到文档里，把时间留给判断与完善。', prompt: '根据这份会议记录，整理会议纪要，列出待办事项、负责人和待确认的问题。', file: '会议纪要.docx', content: '<h4>让每一次讨论，都有下一步</h4><p class="sheet-subtitle">项目沟通会议纪要</p><div class="document-rule"></div><h5>讨论结论</h5><p>明确本阶段的交付范围，优先完成核心流程验证。</p><h5>待办事项</h5><ul><li>整理需求清单，确认验收标准</li><li>补齐测试数据，验证关键场景</li><li>同步待确认事项，安排下一次评审</li></ul><div class="sheet-note">待确认：评审时间与参与人员</div>' },
  data: { kind: '表格分析', title: '从一张表里，\n找到下一步的线索。', description: '整理数据、核对口径、汇总对比。把重复的表格处理交给 HiBuddy，再一起检查结论。', prompt: '汇总工作区里各部门的任务台账，按状态统计数量，标出缺失字段，并生成一份新的 Excel 汇总表。', file: '任务汇总.xlsx', content: '<h4>把进度，看得更清楚</h4><p class="sheet-subtitle">任务台账汇总 · 示例数据</p><table><thead><tr><th>任务状态</th><th>数量</th><th>待跟进</th></tr></thead><tbody><tr><td>已完成</td><td>24</td><td>归档材料</td></tr><tr><td>进行中</td><td>12</td><td>确认交付时间</td></tr><tr><td>待确认</td><td>4</td><td>补齐负责人</td></tr></tbody></table><h5>数据检查</h5><p>4 条记录缺少负责人，已在汇总表中单独标记。</p><div class="sheet-note">汇总口径：按任务状态分组，空值单独列出</div>' },
  slides: { kind: '汇报准备', title: '从一堆材料，\n到一个清晰的表达。', description: '先梳理汇报逻辑，再组织每一页内容。用已有资料起草演示文稿，把精力放在重点与结论上。', prompt: '根据工作区里的项目材料，制作一份阶段汇报 PPT，包含目标、进展、问题和下一步计划。没有依据的数据不要编造。', file: '项目阶段汇报.pptx', content: '<h4>项目阶段汇报</h4><p class="sheet-subtitle">把进展讲清楚，把下一步说具体</p><div class="document-rule"></div><h5>本阶段目标</h5><p>验证核心流程，明确交付范围与验收标准。</p><h5>汇报结构</h5><ul><li>目标与背景</li><li>已完成工作与成果</li><li>当前问题与待决策事项</li><li>下一阶段计划</li></ul><div class="sheet-note">每一页围绕一个主题展开</div>' },
  code: { kind: '代码协作', title: '让重复的操作，\n变成可复用的工具。', description: '阅读代码、编写脚本、排查问题。从一个具体的小任务开始，让 HiBuddy 帮你完成开发工作。', prompt: '帮我编写一个整理文件的脚本，按文件类型分类。先给出方案和预览，不要直接移动或删除原文件。', file: '文件整理方案.md', content: '<h4>先确认，再执行</h4><p class="sheet-subtitle">文件分类脚本 · 方案示例</p><div class="document-rule"></div><h5>处理步骤</h5><ul><li>扫描指定工作目录</li><li>按扩展名归类，保留原始文件名</li><li>输出预览清单，等待确认</li></ul><pre>工作资料/\n  文档/     .docx  .pdf\n  表格/     .xlsx  .csv\n  演示/     .pptx</pre><div class="sheet-note">默认预览，不直接修改文件</div>' },
};
const tabs = [...document.querySelectorAll('[data-scenario]')];
let currentScenario = 'documents';
let copyAttempt = 0;
function selectScenario(tab) {
  currentScenario = tab.dataset.scenario;
  copyAttempt++;
  const scenario = scenarios[currentScenario];
  for (const item of tabs) { item.setAttribute('aria-selected', String(item === tab)); item.tabIndex = item === tab ? 0 : -1; }
  document.getElementById('scenario-panel').setAttribute('aria-labelledby', tab.id);
  document.getElementById('scenario-kind').textContent = scenario.kind;
  document.getElementById('scenario-title').innerText = scenario.title;
  document.getElementById('scenario-description').textContent = scenario.description;
  document.getElementById('scenario-prompt').textContent = `“${scenario.prompt}”`;
  document.getElementById('example-type').textContent = scenario.file;
  document.getElementById('example-content').innerHTML = scenario.content;
  document.getElementById('copy-status').textContent = '';
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectScenario(tab));
  tab.addEventListener('keydown', event => {
    let index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault(); selectScenario(tabs[index]); tabs[index].focus();
  });
}
document.getElementById('copy-prompt').addEventListener('click', async () => {
  const attempt = ++copyAttempt;
  const prompt = scenarios[currentScenario].prompt;
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(prompt); copied = true; }
    else {
      // The intranet site uses HTTP, where the asynchronous Clipboard API is unavailable.
      const field = document.createElement('textarea');
      field.value = prompt; field.setAttribute('aria-label', '待复制的指令');
      field.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(field); field.select();
      try { copied = document.execCommand('copy'); } finally { field.remove(); document.getElementById('copy-prompt').focus(); }
    }
  } catch { copied = false; }
  if (attempt === copyAttempt) document.getElementById('copy-status').textContent = copied ? '已复制，可粘贴到 HiBuddy 中使用' : '未能自动复制，请选中上方指令手动复制';
});
function releaseLink(item, label) {
  const container = document.createElement('div'); container.className = 'download-item';
  const link = document.createElement('a'); link.className = 'button'; link.href = item.url; link.download = ''; link.textContent = `${label} ↓`;
  const meta = document.createElement('p'); meta.className = 'download-meta'; meta.textContent = `${item.version} · ${(item.bytes / 1024 / 1024).toFixed(1)} MB`;
  container.append(link, meta); return container;
}
function status(container, text) { const p = document.createElement('p'); p.className = 'release-status'; p.textContent = text; container.replaceChildren(p); }
const windows = document.getElementById('windows-download');
const macos = document.getElementById('macos-download');
fetch('/versions/releases.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) }).then(async response => {
  if (!response.ok) throw new Error('Release list unavailable');
  const records = await response.json();
  if (!Array.isArray(records)) throw new Error('Invalid release list');
  const safe = records.filter(item => {
    if (!item || typeof item.url !== 'string' || typeof item.version !== 'string' || !Number.isSafeInteger(item.bytes) || item.bytes <= 0) return false;
    try { const url = new URL(item.url, location.origin); return url.origin === location.origin && !url.username && !url.password && url.pathname.startsWith('/versions/') && /\.(exe|dmg)$/.test(url.pathname); } catch { return false; }
  });
  const win = safe.find(item => new URL(item.url, location.origin).pathname.endsWith('.exe'));
  if (win) windows.replaceChildren(releaseLink(win, '下载 Windows 64 位')); else status(windows, 'Windows 安装包暂未发布');
  const mac = safe.find(item => item.arch === 'arm64' && new URL(item.url, location.origin).pathname.endsWith('.dmg'));
  if (mac) macos.replaceChildren(releaseLink(mac, '下载 Apple Silicon 版'));
  else status(macos, 'macOS 安装包即将上线');
}).catch(() => { for (const container of [windows, macos]) status(container, '暂时无法读取版本，请前往全部版本页面重试'); });
