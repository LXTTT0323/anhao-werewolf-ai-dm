import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const outputDir = path.resolve('../outputs/xiaohongshu-demo')
const width = 1242
const height = 1660
const font = 'Microsoft YaHei, Segoe UI, sans-serif'

const frame = (content, accent = '#187a75') => `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="1242" height="1660" fill="#f5f7f4"/>
  <rect x="62" y="55" width="1118" height="1550" rx="34" fill="#ffffff"/>
  <circle cx="101" cy="103" r="11" fill="${accent}"/><text x="124" y="111" font-family="${font}" font-size="26" font-weight="700" fill="#26333e">暗号</text>
  <text x="1070" y="111" font-family="${font}" font-size="19" fill="#7b8790">AI 狼人杀上帝</text>
  ${content}
  <text x="101" y="1554" font-family="${font}" font-size="19" fill="#9aa4a9">内测演示 · 产品概念图</text>
</svg>`

const phone = (x, y, body, scale = 1) => `
<g transform="translate(${x} ${y}) scale(${scale})">
  <rect width="414" height="790" rx="55" fill="#19242d"/>
  <rect x="12" y="12" width="390" height="766" rx="44" fill="#fcfdfb"/>
  <rect x="150" y="24" width="114" height="24" rx="12" fill="#19242d"/>
  <text x="38" y="51" font-family="${font}" font-size="16" font-weight="700" fill="#42505b">9:41</text>
  <text x="319" y="51" font-family="${font}" font-size="15" fill="#6e7b84">● ● ●</text>
  ${body}
</g>`

const button = (x, y, label, tone = '#227a74', w = 328) => `<rect x="${x}" y="${y}" width="${w}" height="56" rx="8" fill="${tone}"/><text x="${x + w / 2}" y="${y + 36}" text-anchor="middle" font-family="${font}" font-size="18" font-weight="700" fill="#ffffff">${label}</text>`

const slides = [
  ['01-cover.png', frame(`
    <text x="101" y="255" font-family="${font}" font-size="30" font-weight="700" fill="#1b766f">想做一个小东西</text>
    <text x="101" y="352" font-family="${font}" font-size="78" font-weight="800" fill="#202e38">能当上帝的</text>
    <text x="101" y="446" font-family="${font}" font-size="78" font-weight="800" fill="#202e38">狼人杀 AI</text>
    <text x="101" y="505" font-family="${font}" font-size="27" fill="#74808a">每人一部手机，流程交给 AI，大家只管玩。</text>
    ${phone(414, 610, `
      <text x="207" y="98" text-anchor="middle" font-family="${font}" font-size="15" font-weight="700" fill="#68757e">房间 8F7K6</text>
      <text x="44" y="179" font-family="${font}" font-size="17" fill="#6e7b84">9 人标准局</text>
      <text x="44" y="224" font-family="${font}" font-size="40" font-weight="800" fill="#24313c">等大家入座</text>
      <text x="44" y="260" font-family="${font}" font-size="17" fill="#78858e">扫码加入后，AI 自动发身份</text>
      <rect x="44" y="307" width="326" height="136" rx="12" fill="#eff5f2"/>
      <text x="207" y="350" text-anchor="middle" font-family="${font}" font-size="18" fill="#40625f">已就绪</text>
      <text x="207" y="405" text-anchor="middle" font-family="${font}" font-size="42" font-weight="800" fill="#1d7770">8 / 9</text>
      ${button(44, 612, '显示入房二维码')}
    `, 1.02)}
    <text x="621" y="1478" text-anchor="middle" font-family="${font}" font-size="23" fill="#56636b">线下局 / 线上局 都能用</text>
  `)],
  ['02-identity.png', frame(`
    <text x="101" y="235" font-family="${font}" font-size="30" font-weight="700" fill="#1b766f">01 · 玩家手机</text>
    <text x="101" y="326" font-family="${font}" font-size="66" font-weight="800" fill="#202e38">身份只给本人看</text>
    <text x="101" y="380" font-family="${font}" font-size="26" fill="#74808a">不用再闭眼传牌，也不用担心别人瞄到。</text>
    ${phone(414, 505, `
      <text x="207" y="98" text-anchor="middle" font-family="${font}" font-size="15" font-weight="700" fill="#68757e">房间 8F7K6</text>
      <text x="44" y="162" font-family="${font}" font-size="16" fill="#63727b">🔒 仅你可见</text>
      <rect x="44" y="197" width="70" height="32" rx="5" fill="#fdf0d8"/><text x="79" y="219" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#a66d21">神职</text>
      <text x="44" y="292" font-family="${font}" font-size="55" font-weight="800" fill="#26333d">预言家</text>
      <text x="44" y="332" font-family="${font}" font-size="17" fill="#74808b">每晚可查验一名存活玩家的阵营。</text>
      <rect x="44" y="388" width="326" height="102" fill="#eef4f2"/><rect x="44" y="388" width="4" height="102" fill="#69aaa1"/>
      <text x="70" y="428" font-family="${font}" font-size="15" fill="#74818a">第 2 夜即将开始</text><text x="70" y="462" font-family="${font}" font-size="19" font-weight="700" fill="#34434d">请等待 AI 叫你睁眼</text>
      ${button(44, 616, '我知道了')}
    `, 1.06)}
    <text x="621" y="1448" text-anchor="middle" font-family="${font}" font-size="23" fill="#56636b">夜晚行动、投票，也都在这里完成</text>
  `)],
  ['03-host.png', frame(`
    <text x="101" y="235" font-family="${font}" font-size="30" font-weight="700" fill="#1b766f">02 · 不用额外买设备</text>
    <text x="101" y="326" font-family="${font}" font-size="64" font-weight="800" fill="#202e38">主持手机也能上场</text>
    <text x="101" y="380" font-family="${font}" font-size="26" fill="#74808a">公开主持屏与私密玩家页，严格分开。</text>
    ${phone(130, 515, `
      <text x="207" y="98" text-anchor="middle" font-family="${font}" font-size="15" font-weight="700" fill="#68757e">主持屏</text>
      <text x="44" y="180" font-family="${font}" font-size="16" fill="#489285">● AI 上帝在线</text>
      <text x="44" y="242" font-family="${font}" font-size="40" font-weight="800" fill="#27343e">3 号玩家发言</text>
      <text x="44" y="286" font-family="${font}" font-size="21" fill="#6e7b84">倒计时 1:42</text>
      <rect x="44" y="342" width="326" height="123" rx="12" fill="#213a48"/><text x="207" y="394" text-anchor="middle" font-family="${font}" font-size="18" fill="#b9d7d1">公共状态</text><text x="207" y="435" text-anchor="middle" font-family="${font}" font-size="20" font-weight="700" fill="#ffffff">8 人存活 · 1 人出局</text>
      ${button(44, 620, '下一位发言')}
    `, .88)}
    ${phone(664, 650, `
      <text x="207" y="98" text-anchor="middle" font-family="${font}" font-size="15" font-weight="700" fill="#68757e">你的私密页</text>
      <text x="44" y="180" font-family="${font}" font-size="16" fill="#63727b">🔒 仅你可见</text>
      <text x="44" y="254" font-family="${font}" font-size="42" font-weight="800" fill="#27343e">你的身份</text>
      <text x="44" y="305" font-family="${font}" font-size="23" fill="#1f7973">预言家</text>
      <text x="44" y="370" font-family="${font}" font-size="16" fill="#74808a">主持屏永远不会显示这部分。</text>
      ${button(44, 612, '回到主持屏')}
    `, .72)}
    <path d="M560 875 C600 835, 650 835, 680 870" fill="none" stroke="#d4a34e" stroke-width="5" stroke-dasharray="9 9"/>
    <text x="621" y="1458" text-anchor="middle" font-family="${font}" font-size="23" fill="#56636b">一部手机也能开局，多设备体验更舒服</text>
  `)],
  ['04-recap.png', frame(`
    <text x="101" y="235" font-family="${font}" font-size="30" font-weight="700" fill="#1b766f">03 · 真的有人会用到</text>
    <text x="101" y="326" font-family="${font}" font-size="64" font-weight="800" fill="#202e38">离开五分钟回来</text>
    <text x="101" y="404" font-family="${font}" font-size="64" font-weight="800" fill="#202e38">也能立刻跟上</text>
    <text x="101" y="457" font-family="${font}" font-size="26" fill="#74808a">AI 只讲你本来就有权限知道的公开事件。</text>
    ${phone(414, 565, `
      <text x="207" y="98" text-anchor="middle" font-family="${font}" font-size="15" font-weight="700" fill="#68757e">公开记录</text>
      <text x="44" y="174" font-family="${font}" font-size="16" fill="#3a847d">✦ 只含公开信息</text>
      <text x="44" y="235" font-family="${font}" font-size="35" font-weight="800" fill="#27343e">刚才发生了什么</text>
      <line x1="44" y1="280" x2="370" y2="280" stroke="#e2e8e4"/>
      <text x="44" y="326" font-family="${font}" font-size="14" fill="#9aa3a8">09:12</text><text x="104" y="326" font-family="${font}" font-size="17" fill="#3e4c55">天亮，6 号出局。</text>
      <text x="44" y="386" font-family="${font}" font-size="14" fill="#9aa3a8">09:14</text><text x="104" y="386" font-family="${font}" font-size="17" fill="#3e4c55">2 号更怀疑 5 号。</text>
      <text x="44" y="446" font-family="${font}" font-size="14" fill="#9aa3a8">09:16</text><text x="104" y="446" font-family="${font}" font-size="17" fill="#3e4c55">现在轮到 3 号发言。</text>
      ${button(44, 614, '我跟上了')}
    `, 1.05)}
    <text x="621" y="1468" text-anchor="middle" font-family="${font}" font-size="23" fill="#56636b">不剧透夜晚信息，不替你判断谁是狼</text>
  `)],
  ['05-testers.png', frame(`
    <text x="101" y="250" font-family="${font}" font-size="31" font-weight="700" fill="#1b766f">正在做第一版</text>
    <text x="101" y="344" font-family="${font}" font-size="72" font-weight="800" fill="#202e38">想找一桌人</text>
    <text x="101" y="430" font-family="${font}" font-size="72" font-weight="800" fill="#202e38">一起真测</text>
    <rect x="101" y="496" width="1040" height="1" fill="#dfe6e1"/>
    <text x="101" y="578" font-family="${font}" font-size="28" font-weight="700" fill="#283640">第一版会先做这些：</text>
    <circle cx="122" cy="644" r="9" fill="#1b766f"/><text x="150" y="653" font-family="${font}" font-size="27" fill="#52616a">扫码进房，手机看身份</text>
    <circle cx="122" cy="708" r="9" fill="#1b766f"/><text x="150" y="717" font-family="${font}" font-size="27" fill="#52616a">夜晚行动、发言计时、投票</text>
    <circle cx="122" cy="772" r="9" fill="#1b766f"/><text x="150" y="781" font-family="${font}" font-size="27" fill="#52616a">离席补课与赛后复盘</text>
    <rect x="101" y="850" width="1040" height="430" rx="22" fill="#173b42"/>
    <text x="158" y="941" font-family="${font}" font-size="25" fill="#b7d8d0">适合找这样的局</text>
    <text x="158" y="1020" font-family="${font}" font-size="48" font-weight="800" fill="#ffffff">每次都缺上帝</text>
    <text x="158" y="1081" font-family="${font}" font-size="48" font-weight="800" fill="#ffffff">但又想认真玩一局</text>
    <text x="158" y="1171" font-family="${font}" font-size="24" fill="#c4d5d1">想参加内测，可以评论区留一个“狼”。</text>
    <text x="621" y="1438" text-anchor="middle" font-family="${font}" font-size="24" fill="#6a7880">不是要把人赶出桌游，而是把流程从人手里拿走。</text>
  `)],
]

await mkdir(outputDir, { recursive: true })
await Promise.all(slides.map(async ([name, svg]) => {
  await sharp(Buffer.from(svg)).png().toFile(path.join(outputDir, name))
}))

await writeFile(path.join(outputDir, 'README.txt'), '小红书轮播图：按 01 到 05 顺序发布。建议封面文字在小红书内添加，避免平台压缩导致字体模糊。\n', 'utf8')
console.log(`Rendered ${slides.length} slides to ${outputDir}`)
