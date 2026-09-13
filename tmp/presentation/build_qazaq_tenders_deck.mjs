import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const workspaceDir = '/Users/nuralibaibossynov/qazaq-tenders';
const SKILL_DIR = '/Users/nuralibaibossynov/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const TMP_DIR = path.join(workspaceDir, 'tmp/presentation');
const FINAL_PPTX = path.join(workspaceDir, 'output/presentation/Qazaq_Tenders_konkurs_presentation_v2.pptx');
const RUNTIME_PYTHON = '/Users/nuralibaibossynov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
await fs.mkdir(TMP_DIR, { recursive: true });
await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });

const { resolvePresentationFont, applyPresentationChartFont, finalizePresentation } = await import(
  pathToFileURL(path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs')).href
);
const font = resolvePresentationFont({ preferredFamilies: ['Arial', 'Aptos', 'DejaVu Sans'] });
const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });

const C = { bg:'#071411', bg2:'#0B201A', green:'#5CFF67', mint:'#BFFFC5', white:'#FFFFF8', gray:'#A8B8B0', red:'#FF6B6B', amber:'#FFD166' };
function box(slide, text, x, y, w, h, size=24, color=C.white, bold=false, align='left') {
  const s = slide.shapes.add({ geometry:'textbox', position:{left:x,top:y,width:w,height:h}, fill:'none', line:{fill:'none',width:0} });
  s.text = text; s.text.style = { typeface:font, fontSize:size, color, bold, autoFit:'shrinkText', textAlign:align, verticalAlignment:'middle' }; return s;
}
function base(title, no) {
  const s=deck.slides.add(); s.background.fill=C.bg;
  box(s,'Qazaq Tenders',58,30,220,30,18,C.green,true);
  box(s,String(no).padStart(2,'0'),1160,30,60,28,16,C.gray,true,'right');
  box(s,title,58,82,1160,68,38,C.white,true);
  return s;
}
function bullet(slide, text, y, accent=C.green) {
  box(slide,'●',74,y,28,40,18,accent,true);
  box(slide,text,112,y-2,1050,52,24,C.white,false);
}
function notes(slide, text){ slide.speakerNotes.textFrame.setText(text); }

// 1
{
 const s=deck.slides.add(); s.background.fill=C.bg;
 box(s,'QAZAQ\nTENDERS',64,90,610,210,66,C.white,true);
 box(s,'Шағын және орта бизнеске мемлекеттік сатып алудың экономикалық тиімділігін бағалайтын интеллектуалды платформа',68,326,730,120,28,C.mint,false);
 box(s,'Нұрали Байбосынов  |  11A',68,540,520,42,22,C.white,true);
 box(s,'www.qazaqtenders.kz',68,594,420,32,18,C.green,false);
 box(s,'2026',1080,590,120,34,20,C.gray,true,'right');
 notes(s,'Қайырлы күн, құрметті қазылар алқасы! Qazaq Tenders кәсіпкерге тендердің пайдасын, тәуекелін және қажетті айналым қаражатын алдын ала бағалауға көмектеседі.');
}
// 2
{
 const s=base('Бүгінгі жоспар',2);
 ['Өзектілік және мәселе','Qazaq Tenders шешімі','Жүйе архитектурасы','Экономикалық модель','Логистика және жеткізушілер','Есептік нәтиже','Тексеру және қорытынды'].forEach((t,i)=>{
   box(s,String(i+1).padStart(2,'0'),80,175+i*62,52,38,20,C.green,true);
   box(s,t,155,171+i*62,850,45,25,C.white,i===0);
 });
 notes(s,'Алдымен мәселені көрсетемін, одан кейін жүйенің жұмысын, формулаларын және нақты есептік сценарийді түсіндіремін.');
}
// 3
{
 const s=base('Өзектілік',3);
 box(s,'2,17 млн',70,180,350,90,58,C.green,true);
 box(s,'Қазақстандағы белсенді ШОБ субъектілері',72,270,430,62,23,C.white,false);
 box(s,'40,9%',670,180,300,90,58,C.green,true);
 box(s,'ШОБ-тың ЖІӨ-дегі үлесі',672,270,360,62,23,C.white,false);
 box(s,'Мемлекеттік сатып алу бизнеске үлкен мүмкіндік береді. Бірақ құжаттарды қате түсіну, шығынды толық есептемеу және төлемді күту шағын кәсіпорын үшін нақты қаржылық тәуекел туғызады.',72,405,1090,150,27,C.white,false);
 box(s,'Дереккөз: ҚР Ұлттық статистика бюросы, 01.01.2026',72,635,700,24,14,C.gray,false);
 notes(s,'Қазақстанда 2,17 миллион белсенді ШОБ субъектісі бар, ал олардың ЖІӨ-дегі үлесі 40,9 пайыз. Сондықтан мемлекеттік сатып алудағы шешім сапасы экономика үшін маңызды.');
}
// 4
{
 const s=base('Кәсіпкердің негізгі тәуекелдері',4);
 ['Күрделі құжаттар','Жасырын шығындар','Кассалық алшақтық','Арнайы талаптар'].forEach((t,i)=>{
   box(s,String(i+1),75,175+i*105,55,55,28,C.green,true,'center');
   box(s,t,160,168+i*105,370,48,27,C.white,true);
 });
 box(s,'Техникалық ерекшелік пен шарттардан бір маңызды талаптың жоғалуы өтінімнен бас тартуға әкелуі мүмкін. Пайда оң болғанның өзінде айналым капиталы жеткіліксіз болуы ықтимал.',610,190,530,250,27,C.mint,false);
 box(s,'Мәселе: кәсіпкер шешімді толық қаржылық модельсіз қабылдайды',610,500,530,82,27,C.amber,true);
 notes(s,'Жалпы тендер сомасы кәсіпкердің нақты табысын көрсетпейді. Салық, банк комиссиясы, логистика және төлем мерзімі бірге есептелуі керек.');
}
// 5
{
 const s=base('Qazaq Tenders шешімі',5);
 bullet(s,'PDF, DOCX және API деректерін талдау',175);
 bullet(s,'Техникалық ерекшеліктегі арнайы талаптарды бөлек шығару',245);
 bullet(s,'Пайда, маржа және күнделікті Cash Flow есептеу',315);
 bullet(s,'Көлік пен жеткізуші сценарийлерін бір батырмамен салыстыру',385);
 bullet(s,'Нәтижені 0–100 аралығындағы TOS индексімен түсіндіру',455);
 box(s,'Пайдаланушы ұзақ форма толтырмайды. Жүйе бастапқы мәндерді өзі ұсынады, ал кәсіпкер оларды бір рет басып түзетеді.',75,570,1070,66,24,C.mint,true);
 notes(s,'Пайдаланушы тендерді ашады. Жүйе құжатты оқып, есепті бірден жасайды. Өз жағдайы өзгеше болса, сатып алу бағасын, авансты немесе көлік түрін бір батырмамен өзгертеді.');
}
// 6
{
 const s=base('Екі қабатты архитектура',6);
 const labels=[['PDF / DOCX / API','Кіріс деректері'],['AI қабаты','Фактілер мен талаптар'],['Экономикалық қабат','Формулалар мен күнтізбе'],['Веб және Telegram','Түсіндірілетін нәтиже']];
 labels.forEach((a,i)=>{
   box(s,a[0],60+i*300,225,250,68,27,i===1?C.green:C.white,true,'center');
   box(s,a[1],70+i*300,315,230,70,19,C.gray,false,'center');
   if(i<3) box(s,'›',320+i*300,235,30,50,40,C.green,true,'center');
 });
 box(s,'AI құжатты түсінеді. Экономикалық қабат есепті детерминирленген формулалармен жүргізеді.',90,500,1100,75,29,C.mint,true,'center');
 notes(s,'AI қабаты құжаттан деректерді шығарады. Ол пайда санын ойдан шығармайды. Барлық ақша көрсеткішін жеке экономикалық қозғалтқыш есептейді.');
}
// 7
{
 const s=base('Экономикалық модель',7);
 box(s,'Profit = S − (Cpurchase + Clogistics + Ctax + Cbank + Coperation + Cpenalty)',72,180,1130,80,30,C.white,true,'center');
 box(s,'TOS = 0,35 × Margin + 0,30 × Cash Flow + 0,15 × Logistics + 0,20 × Legal',72,300,1130,80,29,C.green,true,'center');
 box(s,'35%',95,460,180,70,46,C.green,true,'center'); box(s,'Маржа',95,530,180,38,20,C.white,false,'center');
 box(s,'30%',375,460,180,70,46,C.green,true,'center'); box(s,'Cash Flow',375,530,180,38,20,C.white,false,'center');
 box(s,'15%',655,460,180,70,46,C.green,true,'center'); box(s,'Логистика',655,530,180,38,20,C.white,false,'center');
 box(s,'20%',935,460,180,70,46,C.green,true,'center'); box(s,'Құқықтық тәуекел',895,530,260,38,20,C.white,false,'center');
 notes(s,'TOS шешімді төрт өлшем арқылы көрсетеді. Салмақтар бастапқы сараптамалық параметрлер. Кейін оларды аяқталған келісімшарттардың деректерімен калибрлеу қажет.');
}
// 8
{
 const s=base('Smart Defaults және дерек сенімділігі',8);
 const rows=[['Document','Тендер құжатындағы нақты факт','Жоғары'],['Supplier API','Серіктестен алынған баға','Жоғары'],['Smart Default','Санаттық бастапқы бағалау','Орташа'],['User Verified','Пайдаланушы растаған мән','Жоғары']];
 const table=s.tables.add({left:90,top:185,width:1100,height:320,rows:rows.length+1,columns:3,values:[['Дерек белгісі','Мағынасы','Сенімділік'],...rows]});
 const data=[['Дерек белгісі','Мағынасы','Сенімділік'],...rows];
 for(let r=0;r<data.length;r++) for(let c=0;c<3;c++){const cell=table.getCell(r,c);cell.text.style={typeface:font,fontSize:r===0?21:19,bold:r===0,color:r===0?C.green:C.white,autoFit:'shrinkText'};}
 box(s,'Confidence Level болжам дәлдігі емес. Ол кіріс деректерінің қаншасы расталғанын көрсетеді.',95,560,1090,58,23,C.amber,true,'center');
 notes(s,'Жүйе нақты факт пен болжамды мәнді араластырмайды. Confidence Level 95 пайыз болса, бұл деректердің басым бөлігі тексерілгенін білдіреді, экономикалық нәтиженің 95 пайыз дәлдігін емес.');
}
// 9
{
 const s=base('Логистика және жеткізушілер',9);
 ['Газель','Автофура','Теміржол','Авиа'].forEach((t,i)=>{box(s,t,75+i*292,190,245,65,27,i===2?C.green:C.white,true,'center');});
 bullet(s,'Қала мен салмаққа сәйкес көлік тарифі есептеледі',310);
 bullet(s,'Көлік ауысқанда пайда, мерзім және TOS қайта есептеледі',380);
 bullet(s,'Жеткізуші бағасы, қаласы, байланысы және сертификаты көрсетіледі',450);
 box(s,'Нақты API дерегі Verified, ал мысал каталог міндетті түрде DEMO деп белгіленеді.',75,570,1080,55,23,C.amber,true,'center');
 notes(s,'Көлік түрін өзгерткенде логистика шығыны ғана емес, жеткізу мерзімі, кешігу қаупі және ақша ағыны да өзгереді.');
}
// 10
{
 const s=base('84 млн ₸ лот бойынша сценарий',10);
 const chart=s.charts.add('bar',{position:{left:70,top:185,width:690,height:385},categories:['Автоматты','Автофура','Теміржол','Авиа','30% аванс'],series:[{name:'TOS',values:[62.7,60.6,62.0,41.5,73.4],fill:C.green}],barOptions:{direction:'column',grouping:'clustered'},hasLegend:false,dataLabels:{showValue:true,position:'outEnd'},valueAxis:{minimumScale:0,maximumScale:100}}); applyPresentationChartFont(chart,{fontFamily:font});
 box(s,'73,4',850,205,260,90,58,C.green,true,'center'); box(s,'TOS, 30% аванс',850,295,260,42,21,C.white,true,'center');
 box(s,'14,81 млн ₸',820,385,320,70,42,C.white,true,'center'); box(s,'таза пайда',850,455,260,36,20,C.gray,false,'center');
 box(s,'Кассалық алшақтық жоқ',805,535,350,48,23,C.mint,true,'center');
 notes(s,'Аванссыз автоматты сценарийде пайда 14,55 миллион теңге, бірақ кассалық тапшылық 13,19 миллион теңге. 30 пайыз аванс тапшылықты жойып, TOS көрсеткішін 73,4 балға көтереді.');
}
// 11
{
 const s=base('Бағдарламалық тексеру',11);
 box(s,'450',80,190,300,110,72,C.green,true); box(s,'автоматтандырылған тест',82,305,390,52,24,C.white,false);
 box(s,'210',680,190,300,110,72,C.green,true); box(s,'веб және Python паритет сценарийі',682,305,440,60,24,C.white,false);
 bullet(s,'Негізгі формулалар қайталанатын нәтиже береді',430);
 bullet(s,'Нақты және болжамды деректер бөлек таңбаланады',500);
 box(s,'Бұл тексерулер кодтың тұрақтылығын растайды. Нарықтық болжам дәлдігін бөлек пилоттық зерттеу бағалайды.',75,600,1090,50,20,C.amber,true,'center');
 notes(s,'450 автоматтандырылған тест есептеу қозғалтқышының тұрақтылығын тексереді. Бірақ бұл 95 пайыздық экономикалық болжам дәлелденді деген мәлімдеме емес.');
}
// 12
{
 const s=base('Қорытынды',12);
 box(s,'Qazaq Tenders кәсіпкерге тендердің пайдасын ғана емес, оған жету үшін қажет ақша мен тәуекелді де алдын ала көрсетеді.',88,190,1080,150,34,C.white,true,'center');
 bullet(s,'Құжаттағы маңызды талаптар жоғалмайды',390);
 bullet(s,'Қаржылық нәтиже ашық формуламен есептеледі',460);
 bullet(s,'Сценарийлер бір батырмамен салыстырылады',530);
 box(s,'Назарларыңызға рақмет',88,625,1080,36,22,C.green,true,'center');
 notes(s,'Жүйе кәсіпкердің орнына шешім қабылдамайды. Ол шешімнің салдарын алдын ала көруге мүмкіндік береді. Назарларыңызға рақмет, сұрақтарыңызға жауап беруге дайынмын.');
}

const stagingDir=path.join(workspaceDir,'.codex-finalizer'); await fs.mkdir(stagingDir,{recursive:true});
const candidatePath=path.join(stagingDir,'qazaq-tenders-candidate.pptx');
await (await PresentationFile.exportPptx(deck)).save(candidatePath);
const requirements={workspaceDir,explicitTotalSlideCount:12,requiredNativeTableOwnerSlides:[8],requiredNativeChartOwnerSlides:[10],materializeLiteralChartWorkbooks:true};
await finalizePresentation({...requirements,candidatePath,finalPath:FINAL_PPTX,pythonExecutable:RUNTIME_PYTHON,integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit','--require-native-table-slide','8'],requiredNativeTableOwnerSlides:[8],fontPolicy:{basis:'design',families:[font]},verifyArtifactToolImport:true,receiptPath:path.join(stagingDir,'Qazaq_Tenders_konkurs_presentation_v2.validation.json')});
console.log(FINAL_PPTX);
