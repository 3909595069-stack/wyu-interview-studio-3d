/* =====================================================================
   武夷学院 · 毕业生网络视频面试间 —— 360° 交互漫游
   ---------------------------------------------------------------------
   坐标约定
     Blender / 建模系（mm）：原点 = A∩C 内角（素墙那一端）
       X 沿书法墙（B）向东，0 → 6600
       Y 自素墙（C）指向书法墙（B），0 → 3400
       Z 向上，0 → 2750
     斜墙 D：x - y = 3200
     glTF 导出时 yup，three.js 中：
       tx = X * 0.001 ,  ty = Z * 0.001 ,  tz = -Y * 0.001
     于是房间在 three 中占 x∈[0,6.6] z∈[-3.4,0]，素墙在 z=0，书法墙在 z=-3.4
   ===================================================================== */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  /* ------------------------------------------------------------------ 常量 */
  var MM = 0.001;
  var RW = 6600;        // B 墙（书法墙）长度
  var RD = 3400;        // A 墙（进深）
  var CUT = 3200;       // C 墙（素墙）长度；斜墙 x - y = 3200
  var H = 2750;

  var EYE_STAND = 1600; // 站立视高
  var EYE_SIT = 1160;   // 坐姿视高
  var BODY = 230;       // 人体碰撞半径
  var SPEED = 1500;     // 行走速度 mm/s
  var LOOK_RATE = 1.95; // 方向盘转头速度 rad/s
  var PITCH_MAX = 1.45; // ≈83°，可抬头低头但不会翻过去

  /* 家具障碍（mm，建模系）。留出空隙，别让人穿桌子走 */
  var OBST = [
    { x0: 400, x1: 1800, y0: 2700, y1: 3400 },   // 桌 1
    { x0: 1800, x1: 3200, y0: 2700, y1: 3400 },  // 桌 2
    { x0: 3200, x1: 3900, y0: 2000, y1: 3400 },  // 桌 3（垂直转出）
    { x0: 0, x1: 470, y0: 2180, y1: 3400 },      // A 墙货架 / 展示柜
    { x0: 1740, x1: 3180, y0: 0, y1: 470 }       // 素墙最里端的黑椅 + 垃圾桶
  ];

  /* 座位。yaw 为 three 相机 yaw：0 = 面向书法墙(+Y) */
  var SEATS = [
    { name: '黄椅 1 · 书法墙桌前（左）', x: 1100, y: 2400, yaw: 0, dark: false },
    { name: '黄椅 2 · 书法墙桌前（右）', x: 2500, y: 2400, yaw: 0, dark: false },
    { name: '黄椅 3 · 垂直转出的桌', x: 4250, y: 2650, yaw: Math.PI / 2, dark: false },
    { name: '黑椅 1 · 素墙前（左）', x: 2020, y: 235, yaw: 0, dark: true },
    { name: '黑椅 2 · 素墙前（右）', x: 2560, y: 235, yaw: 0, dark: true }
  ];

  /* 罗盘 8 方位（0° = +Y 书法墙，顺时针到 +X 东端） */
  var BEARINGS = ['书法墙', '书法墙东段', '东端', '斜墙', '素墙', '素墙入口端', '大门', '展示柜'];

  /* ------------------------------------------------------------------ 渲染器 */
  var app = $('#app');
  var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  app.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d10);

  var cam = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 120);
  cam.rotation.order = 'YXZ';

  /* ------------------------------------------------------------------ 灯光 */
  // 程序化环境贴图：没有 envMap 时，带金属度的材质（空调风口、金属件）会发黑。
  // 用一张极小的 equirect 贴图模拟"上白下暖"的室内光照，three 会自动 PMREM。
  (function makeEnv() {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    var g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0.00, '#ffffff');
    grad.addColorStop(0.40, '#f0f3f5');
    grad.addColorStop(0.52, '#cdc7bb');
    grad.addColorStop(1.00, '#9d948a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(255,250,238,0.95)';
    [[42, 16], [128, 12], [208, 18]].forEach(function (p) {
      g.beginPath();
      g.ellipse(p[0], p[1], 27, 9, 0, 0, Math.PI * 2);
      g.fill();
    });
    var t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.encoding = THREE.sRGBEncoding;
    scene.environment = t;
  })();

  scene.add(new THREE.AmbientLight(0xe6ecf2, 0.16));
  scene.add(new THREE.HemisphereLight(0xf2f7ff, 0xc0b8ab, 0.10));

  var sun = new THREE.DirectionalLight(0xfff3e2, 0.26);
  sun.position.set(3.4, 6.6, 4.6);
  scene.add(sun);

  var fill = new THREE.DirectionalLight(0xd6e6ff, 0.12);
  fill.position.set(-4.2, 3.4, -6.5);
  scene.add(fill);

  /* 吊顶平板灯：位置来自模型 PANELS，换成 three 坐标 */
  [[1.6, -2.7], [3.2, -2.7], [4.0, -1.2]].forEach(function (p) {
    var pl = new THREE.PointLight(0xfff2dd, 1.6, 7.5, 2);
    pl.position.set(p[0], H * MM - 0.14, p[1]);
    scene.add(pl);
  });

  /* ------------------------------------------------------------------ 玩家状态 */
  var QP = new URLSearchParams(location.search);
  var SPAWN = { x: 780, y: 660, yaw: -0.80 };   // 门口内侧，朝室内斜看：展示柜/桌排在左，斜墙在右前
  var px = SPAWN.x, py = SPAWN.y;
  var yaw = SPAWN.yaw, pitch = 0;
  var eye = EYE_STAND;
  var seated = -1;
  var seatedYaw = 0;

  var moveVec = { x: 0, y: 0 };           // 左盘：x 右正 / y 下正
  var lookVec = { x: 0, y: 0 };           // 右盘
  var keys = Object.create(null);

  var headOn = false;
  var headOff = new THREE.Quaternion();
  var headSeen = false;

  function V3(bx, by, h) {
    return new THREE.Vector3(bx * MM, (h == null ? eye : h) * MM, -by * MM);
  }

  /* ------------------------------------------------------------------ 碰撞 */
  function blocked(bx, by) {
    var r = BODY;
    if (bx < r || by < r || bx > RW - r || by > RD - r) return true;
    // 到斜墙 x - y = CUT 的距离 = (CUT - (x - y)) / √2
    if (bx - by > CUT - r * 1.4142136) return true;
    for (var i = 0; i < OBST.length; i++) {
      var o = OBST[i];
      if (bx > o.x0 - r && bx < o.x1 + r && by > o.y0 - r && by < o.y1 + r) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ 罗盘 */
  var needle = $('#needle'), faceName = $('#faceName').querySelector('b');
  var fwdTmp = new THREE.Vector3();

  function updateCompass() {
    cam.getWorldDirection(fwdTmp);
    // three 前向 (fx, fy, fz) → 建模系 (bx, by) = (fx, -fz)
    var bx = fwdTmp.x, by = -fwdTmp.z;
    var deg = Math.atan2(bx, by) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    needle.style.transform = 'translate(-50%,-100%) rotate(' + deg.toFixed(1) + 'deg)';
    var idx = Math.round(deg / 45) % 8;
    if (faceName.textContent !== BEARINGS[idx]) faceName.textContent = BEARINGS[idx];
  }

  /* ------------------------------------------------------------------ 方向盘 */
  function bindStick(el, out) {
    var knob = el.querySelector('.knob');
    var id = null, cx = 0, cy = 0, rad = 1;

    function set(dx, dy) {
      var d = Math.hypot(dx, dy);
      if (d > rad) { dx *= rad / d; dy *= rad / d; }
      knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      out.x = dx / rad;
      out.y = dy / rad;
    }
    function reset() {
      knob.style.transform = 'translate(0,0)';
      out.x = out.y = 0;
      el.classList.remove('active');
      id = null;
    }
    el.addEventListener('pointerdown', function (e) {
      if (id !== null) return;
      id = e.pointerId;
      el.setPointerCapture(id);
      var r = el.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      rad = r.width * 0.34;
      el.classList.add('active');
      set(e.clientX - cx, e.clientY - cy);
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerId !== id) return;
      set(e.clientX - cx, e.clientY - cy);
      e.preventDefault();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) {
      el.addEventListener(t, function (e) {
        if (e.pointerId !== id) return;
        reset();
      });
    });
  }

  bindStick($('#stickMove'), moveVec);
  bindStick($('#stickLook'), lookVec);

  /* ------------------------------------------------------------------ 键盘 */
  var K = {
    KeyW: 'f', ArrowUp: 'lu', KeyS: 'b', ArrowDown: 'ld',
    KeyA: 'l', ArrowLeft: 'll', KeyD: 'r', ArrowRight: 'lr',
    KeyQ: 'll', KeyE: 'lr'
  };
  window.addEventListener('keydown', function (e) {
    if (K[e.code]) { keys[K[e.code]] = 1; e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) {
    if (K[e.code]) { keys[K[e.code]] = 0; e.preventDefault(); }
  });

  /* ------------------------------------------------------------------ 鼠标 / 触屏拖拽转头 */
  var canvas = renderer.domElement;
  var dragging = false, dragId = -1, lastX = 0, lastY = 0, moved = 0;
  var locked = false;

  canvas.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = true; dragId = e.pointerId; moved = 0;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (locked) {
      yaw -= e.movementX * 0.0026;
      pitch = clampPitch(pitch - e.movementY * 0.0026);
      return;
    }
    if (!dragging || e.pointerId !== dragId) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    yaw -= dx * 0.0042;
    pitch = clampPitch(pitch - dy * 0.0042);
  });
  canvas.addEventListener('pointerup', function (e) {
    if (e.pointerId !== dragId) return;
    dragging = false; dragId = -1;
    // 轻点（几乎没有拖动）→ 锁定鼠标，进入 FPS 式转头
    if (moved < 6 && !locked && e.pointerType === 'mouse' && canvas.requestPointerLock) {
      canvas.requestPointerLock();
    }
  });
  document.addEventListener('pointerlockchange', function () {
    locked = document.pointerLockElement === canvas;
    if (locked) toast('鼠标已锁定 · 移动鼠标转头，Esc 退出');
  });

  function clampPitch(v) { return Math.max(-PITCH_MAX, Math.min(PITCH_MAX, v)); }

  /* ------------------------------------------------------------------ 提示 */
  var toastEl = $('#toast'), toastT = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('on'); }, ms || 2400);
  }

  /* ------------------------------------------------------------------ 座位 */
  var sheet = $('#sheet');
  var btnSit = $('#btnSit'), btnStand = $('#btnStand');

  SEATS.forEach(function (s, i) {
    var row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<i class="' + (s.dark ? 'k' : '') + '"></i><span>' + s.name + '</span>';
    row.addEventListener('click', function () { sit(i); });
    sheet.appendChild(row);
  });

  function sit(i) {
    var s = SEATS[i];
    seated = i;
    px = s.x; py = s.y;
    eye = EYE_SIT;
    seatedYaw = s.yaw;
    yaw = s.yaw; pitch = 0;
    headOn = false; syncHeadBtn();
    sheet.classList.remove('open');
    btnSit.style.display = 'none';
    btnStand.style.display = '';
    toast('已入座 · ' + s.name + '（可自由环顾）');
  }

  function stand() {
    if (seated < 0) return;
    var s = SEATS[seated];
    // 依次尝试：正前方 → 正后方 → 左右侧 → 原地，找第一个不撞墙不撞桌的落脚点
    var fx = -Math.sin(s.yaw), fy = Math.cos(s.yaw);   // 建模系前向
    var rx = fy, ry = -fx;                              // 右向
    var cands = [
      [fx * 620, fy * 620], [-fx * 620, -fy * 620],
      [rx * 620, ry * 620], [-rx * 620, -ry * 620],
      [fx * 620 + rx * 520, fy * 620 + ry * 520],
      [fx * 620 - rx * 520, fy * 620 - ry * 520],
      [0, 0]
    ];
    for (var i = 0; i < cands.length; i++) {
      var nx = s.x + cands[i][0], ny = s.y + cands[i][1];
      if (!blocked(nx, ny)) { px = nx; py = ny; break; }
    }
    seated = -1;
    eye = EYE_STAND;
    btnStand.style.display = 'none';
    btnSit.style.display = '';
    toast('已站起 · 可继续自由行走');
  }

  btnSit.addEventListener('click', function () {
    sheet.classList.toggle('open');
  });
  btnStand.addEventListener('click', stand);
  document.addEventListener('pointerdown', function (e) {
    if (!sheet.classList.contains('open')) return;
    if (sheet.contains(e.target) || btnSit.contains(e.target)) return;
    sheet.classList.remove('open');
  }, true);

  /* ------------------------------------------------------------------ 回到门口 */
  function reset() {
    if (seated >= 0) { seated = -1; btnStand.style.display = 'none'; btnSit.style.display = ''; }
    px = SPAWN.x; py = SPAWN.y; eye = EYE_STAND;
    yaw = SPAWN.yaw; pitch = 0;
    headOn = false; syncHeadBtn();
    toast('已回到门口 · 面朝室内');
  }
  $('#btnReset').addEventListener('click', reset);

  /* ------------------------------------------------------------------ 头部追踪 */
  var btnHead = $('#btnHead');

  function syncHeadBtn() { btnHead.classList.toggle('on', headOn); }

  /* 设备姿态 → 四元数（等价 three.js DeviceOrientationControls） */
  var _euler = new THREE.Euler();
  var _q0 = new THREE.Quaternion();
  var _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  var _zee = new THREE.Vector3(0, 0, 1);
  function devQuat(alpha, beta, gamma, orient) {
    _euler.set(beta, alpha, -gamma, 'YXZ');
    var q = new THREE.Quaternion().setFromEuler(_euler);
    q.multiply(_q1);
    q.multiply(_q0.setFromAxisAngle(_zee, -orient));
    return q;
  }

  function onOrient(e) {
    if (e.alpha == null && e.beta == null) return;
    headSeen = true;
    if (!headOn) return;
    var orient = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    var q = devQuat(
      THREE.MathUtils.degToRad(e.alpha || 0),
      THREE.MathUtils.degToRad(e.beta || 0),
      THREE.MathUtils.degToRad(e.gamma || 0),
      THREE.MathUtils.degToRad(orient)
    );
    cam.quaternion.copy(q).multiply(headOff);
  }
  window.addEventListener('deviceorientation', onOrient, true);

  function enableHead() {
    // 以当前朝向为基准求 offset：camQ = devQ * off  →  off = devQ⁻¹ * camQ
    // 这样接上设备的瞬间画面不会跳，之后只叠加头部转动量
    var cur = cam.quaternion.clone();
    headSeen = false;
    var dev = window.__lastDev;
    if (dev) {
      var q = devQuat(dev[0], dev[1], dev[2], dev[3]);
      headOff.copy(q).invert().multiply(cur);
    } else {
      headOff.identity();
    }
    headOn = true;
    syncHeadBtn();
    toast('头部追踪已开启 · 转动设备环顾四周');
    setTimeout(function () {
      if (headOn && !headSeen) {
        headOn = false; syncHeadBtn();
        toast('未检测到陀螺仪数据 · 该设备可能不支持');
      }
    }, 1600);
  }

  function disableHead() {
    // 把当前四元数回读成 yaw / pitch，避免关闭时跳转
    var e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    yaw = e.y;
    pitch = clampPitch(e.x);
    headOn = false;
    syncHeadBtn();
    toast('头部追踪已关闭');
  }

  btnHead.addEventListener('click', function () {
    if (headOn) { disableHead(); return; }
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(function (r) {
        if (r === 'granted') enableHead();
        else toast('未获得运动权限 · 无法开启头部追踪');
      }).catch(function () { toast('运动权限请求失败'); });
    } else if (typeof DeviceOrientationEvent === 'undefined') {
      toast('此浏览器不支持设备姿态 · 请用鼠标或方向盘转头');
    } else {
      enableHead();
    }
  });

  /* 记录最近一次设备姿态，供开启瞬间对齐用 */
  window.addEventListener('deviceorientation', function (e) {
    window.__lastDev = [
      THREE.MathUtils.degToRad(e.alpha || 0),
      THREE.MathUtils.degToRad(e.beta || 0),
      THREE.MathUtils.degToRad(e.gamma || 0),
      THREE.MathUtils.degToRad((screen.orientation && screen.orientation.angle) || window.orientation || 0)
    ];
  }, true);

  /* ------------------------------------------------------------------ 帮助 */
  var help = $('#help');
  $('#btnHelp').addEventListener('click', function () { help.classList.remove('hide'); });
  $('#btnGo').addEventListener('click', function () { help.classList.add('hide'); });
  help.addEventListener('click', function (e) {
    if (e.target === help) help.classList.add('hide');
  });

  /* ------------------------------------------------------------------ 载入模型 */
  var loading = $('#loading');
  var loader = new THREE.GLTFLoader();

  function b64ToBuf(b64) {
    var bin = atob(b64);
    var n = bin.length;
    var u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  try {
    var buf = b64ToBuf(window.__MODEL_B64);
    loader.parse(buf, '', function (gltf) {
      var root = gltf.scene;
      root.traverse(function (o) {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) {
          if (!m) return;
          if (m.map) m.map.encoding = THREE.sRGBEncoding;
          if (m.emissiveMap) m.emissiveMap.encoding = THREE.sRGBEncoding;
          // 环境贴图只用来"救"金属件，漫反射给太多整个房间会发白
          m.envMapIntensity = 0.45;
          m.side = THREE.FrontSide;
        });
      });
      scene.add(root);
      loading.classList.add('hide');
      setTimeout(function () { loading.style.display = 'none'; }, 500);
      toast('模型已载入 · 左盘移动，右盘转头');
    }, function (err) {
      loading.textContent = '模型载入失败：' + err;
      console.error(err);
    });
  } catch (e) {
    loading.textContent = '模型数据解析失败';
    console.error(e);
  }

  /* ------------------------------------------------------------------ 主循环 */
  var clock = new THREE.Clock();
  var tmpQ = new THREE.Quaternion();

  function tick() {
    requestAnimationFrame(tick);
    var dt = Math.min(clock.getDelta(), 0.05);

    /* --- 转头 --- */
    var lx = lookVec.x, ly = lookVec.y;
    if (keys.ll) lx -= 1;
    if (keys.lr) lx += 1;
    if (keys.lu) ly -= 1;
    if (keys.ld) ly += 1;
    if (lx || ly) {
      var m = Math.hypot(lx, ly);
      if (m > 1) { lx /= m; ly /= m; }
      if (!headOn) {
        yaw -= lx * LOOK_RATE * dt;
        pitch = clampPitch(pitch - ly * LOOK_RATE * dt);
      }
    }

    /* --- 行走 --- */
    var fx = -moveVec.y, sx = moveVec.x;
    if (keys.f) fx += 1;
    if (keys.b) fx -= 1;
    if (keys.l) sx -= 1;
    if (keys.r) sx += 1;

    if (seated < 0 && (fx || sx)) {
      var l = Math.hypot(fx, sx);
      if (l > 1) { fx /= l; sx /= l; }
      var dx = (-Math.sin(yaw) * fx + Math.cos(yaw) * sx) * SPEED * dt;
      var dy = (Math.cos(yaw) * fx + Math.sin(yaw) * sx) * SPEED * dt;
      if (!blocked(px + dx, py)) px += dx;
      if (!blocked(px, py + dy)) py += dy;
    }

    /* --- 应用到相机 --- */
    var p = V3(px, py, eye);
    cam.position.copy(p);
    if (!headOn) {
      cam.rotation.x = pitch;
      cam.rotation.y = yaw;
      cam.rotation.z = 0;
    }

    updateCompass();
    renderer.render(scene, cam);
  }

  /* ------------------------------------------------------------------ 自适应 */
  window.addEventListener('resize', function () {
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ------------------------------------------------------------------ 调试接口
     只读状态 + 输入注入，方便自动化自测；不影响正常交互 */
  window.__studio = {
    get state() {
      return { x: px, y: py, yaw: yaw, pitch: pitch, eye: eye, seated: seated };
    },
    setMove: function (x, y) { moveVec.x = x; moveVec.y = y; },
    setLook: function (x, y) { lookVec.x = x; lookVec.y = y; },
    blocked: blocked
  };

  /* ------------------------------------------------------------------ 启动 */
  // 可选深链接参数：?x=1620&y=235&yaw=0&pitch=0&seat=3&noh=1
  if (QP.has('x')) px = parseFloat(QP.get('x'));
  if (QP.has('y')) py = parseFloat(QP.get('y'));
  if (QP.has('yaw')) yaw = parseFloat(QP.get('yaw'));
  if (QP.has('pitch')) pitch = clampPitch(parseFloat(QP.get('pitch')));
  if (QP.has('seat')) { var _s = parseInt(QP.get('seat'), 10); if (SEATS[_s]) sit(_s); }
  if (QP.has('noh')) { help.classList.add('hide'); }

  cam.position.copy(V3(px, py, eye));
  cam.rotation.x = pitch;
  cam.rotation.y = yaw;
  tick();
})();
