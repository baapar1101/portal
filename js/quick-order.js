/* quick-order.js — v2 — «خرید سریع» برای مشتری
   ---------------------------------------------------------------------------
   مدل کار عمداً با نسخهٔ قبل فرق دارد:
   ردیف‌ها را سرور با <widget type="products"> رندر می‌کند (پس عنوان، تصویر و
   قیمت دقیقاً همان چیزی است که بقیهٔ سایت نشان می‌دهد و مدیر هم می‌تواند از
   پنل انتخاب کند چه کالاهایی اینجا بیایند). این فایل فقط سه کار می‌کند:

     ۱. hydrate: شناسهٔ تنوع، موجودی و قیمت عددی هر ردیف را یک‌جا می‌گیرد
        GET /site/api/v1/store/products/bulk?id=1,2,3
     ۲. sync: شمارنده‌ها را با سبد واقعی هم‌گام می‌کند
        GET /site/api/v1/cart
     ۳. mutate: هر تغییر شمارنده را در سبد واقعی می‌نویسد
        POST /site/api/v1/cart {variant_id, quantity}
        PUT  /site/api/v1/cart/{item} {quantity}
        DELETE /site/api/v1/cart/{item}

   جست‌وجو، مرتب‌سازی و فیلتر موجودی همگی سمت کلاینت روی همان ردیف‌های
   رندرشده انجام می‌شوند — بدون هیچ درخواست شبکه‌ای.

   ⚠ تنها نقطهٔ نیازمند تطبیق: mapProduct و mapCartItem پایین. */

(function () {
	'use strict';

	var root = document.getElementById('qo-app');
	if (!root) return;

	var API = {
		bulk: '/site/api/v1/store/products/bulk',
		cart: '/site/api/v1/cart'
	};

	var CONFIG = { debounce: 450, chunk: 40 };

	var rows = [];          // { el, id, title, price, stock, variants, variantId, cartItemId, quantity }
	var cartTotal = 0, cartCount = 0;
	var isGuest = root.dataset.guest === 'true' || root.dataset.guest === '1';

	/* ------------------------------------------------------------ کمکی‌ها */

	function $(sel, ctx) { return (ctx || root).querySelector(sel); }
	function all(sel, ctx) { return Array.prototype.slice.call((ctx || root).querySelectorAll(sel)); }
	function cookie(name) {
		var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
		return m ? decodeURIComponent(m.pop()) : '';
	}
	function money(v) { return (Number(v) || 0).toLocaleString('fa-IR'); }

	function request(method, url, body) {
		var headers = { 'Accept': 'application/json' };
		var token = cookie('XSRF-TOKEN');
		if (token) headers['X-XSRF-TOKEN'] = token;
		if (body) headers['Content-Type'] = 'application/json;charset=utf-8';

		return fetch(url, { method: method, headers: headers, credentials: 'same-origin',
			body: body ? JSON.stringify(body) : undefined })
			.then(function (res) {
				return res.json().catch(function () { return {}; }).then(function (data) {
					if (window.QuickOrder && window.QuickOrder.debug) console.log(method, url, res.status, data);
					if (res.status === 401 || res.status === 403) { var e = new Error('auth'); e.auth = true; throw e; }
					if (!res.ok) throw new Error((data && (data.message || data.error)) || 'خطا در ارتباط با سرور');
					return data;
				});
			});
	}

	/* ------------------------------------- آداپتور پاسخ سرور (نقطهٔ تطبیق) */

	function mapProduct(raw) {
		var variants = raw.variants || [];
		if (!Array.isArray(variants)) variants = [variants];
		return {
			id: raw.id,
			variants: variants.map(function (v) {
				return {
					id:    v.id || v.variant_id,
					title: v.title || v.name || '',
					price: Number(v.price) || 0,
					stock: v.stock == null ? null : Number(v.stock),
					max:   v.max_order == null ? null : Number(v.max_order)
				};
			})
		};
	}

	function mapCartItem(raw) {
		return {
			itemId:    raw.id,
			variantId: raw.variant_id || (raw.variant && raw.variant.id) || null,
			productId: raw.product_id || (raw.product && raw.product.id) || null,
			quantity:  Number(raw.quantity) || 0
		};
	}

	/* ------------------------------------------------------------ راه‌اندازی */

	function collectRows() {
		rows = all('.qo-row').map(function (el) {
			return {
				el: el,
				id: el.dataset.id,
				title: el.dataset.title || '',
				outofstock: el.dataset.outofstock === '1',
				price: 0, stock: null, max: null,
				variants: [], variantId: null,
				cartItemId: null, quantity: 0
			};
		});
	}

	function hydrate() {
		var ids = rows.filter(function (r) { return r.id; }).map(function (r) { return r.id; });
		if (!ids.length) return Promise.resolve();

		var chunks = [];
		for (var i = 0; i < ids.length; i += CONFIG.chunk) chunks.push(ids.slice(i, i + CONFIG.chunk));

		return chunks.reduce(function (chain, chunk) {
			return chain.then(function () {
				return request('GET', API.bulk + '?id=' + encodeURIComponent(chunk.join(',')))
					.then(function (data) {
						var list = (data && (data.result || data.results || data.items)) || data || [];
						if (!Array.isArray(list)) list = [list];
						list.map(mapProduct).forEach(applyProduct);
					})
					.catch(function () { /* hydration اختیاری است؛ صفحه بدون آن هم نمایش داده می‌شود */ });
			});
		}, Promise.resolve());
	}

	function applyProduct(p) {
		var row = rows.filter(function (r) { return String(r.id) === String(p.id); })[0];
		if (!row || !p.variants.length) return;

		row.variants = p.variants;
		var v = p.variants[0];
		row.variantId = v.id;
		row.price = v.price;
		row.stock = v.stock;
		row.max = v.max;

		if (p.variants.length > 1) {
			var wrap = $('.qo-variant-wrap', row.el);
			wrap.hidden = false;
			wrap.innerHTML = '<select class="form-control qo-variant" aria-label="انتخاب تنوع ' + row.title + '">' +
				p.variants.map(function (x) {
					return '<option value="' + x.id + '">' + (x.title || 'پیش‌فرض') + '</option>';
				}).join('') + '</select>';
		}
		renderRow(row);
	}

	function syncCart() {
		return request('GET', API.cart).then(function (data) {
			var items = (data && (data.result || data.items)) || [];
			if (!Array.isArray(items)) items = [];
			items = items.map(mapCartItem);

			rows.forEach(function (row) {
				var hit = items.filter(function (it) {
					return (row.variantId && String(it.variantId) === String(row.variantId)) ||
					       (it.productId && String(it.productId) === String(row.id));
				})[0];
				row.cartItemId = hit ? hit.itemId : null;
				row.quantity   = hit ? hit.quantity : 0;
				renderRow(row);
			});

			readTotals(data);
		}).catch(function () { /* مهمان یا سبد خالی */ });
	}

	function readTotals(data) {
		var d = data || {};
		cartTotal = Number(d.total || d.sum || (d.result && d.result.total) || 0);
		cartCount = rows.reduce(function (n, r) { return n + r.quantity; }, 0);
		if (!cartTotal) cartTotal = rows.reduce(function (n, r) { return n + r.price * r.quantity; }, 0);
		renderSummary();
	}

	/* ------------------------------------------------------------ نمایش */

	function renderRow(row) {
		var addBtn  = $('.qo-add', row.el);
		var stepper = $('.qo-stepper', row.el);
		var qtyInput = $('.qo-qty', row.el);
		var total = $('.qo-line-total', row.el);
		var warn = $('.qo-stock-warn', row.el);

		if (!addBtn || !stepper) return;

		if (row.quantity > 0) {
			addBtn.hidden = true;
			stepper.hidden = false;
			if (qtyInput && document.activeElement !== qtyInput) qtyInput.value = row.quantity;
			total.textContent = row.price ? money(row.price * row.quantity) : '—';
			row.el.classList.add('qo-row-active');
		} else {
			addBtn.hidden = false;
			stepper.hidden = true;
			total.textContent = '—';
			row.el.classList.remove('qo-row-active');
		}

		if (warn) {
			if (row.stock != null && row.stock > 0 && row.stock <= 5) {
				warn.hidden = false;
				warn.textContent = 'تنها ' + money(row.stock) + ' عدد موجود';
			} else warn.hidden = true;
		}
	}

	function renderSummary() {
		$('#qo-sum-count').textContent = money(cartCount);
		$('#qo-sum-total').textContent = money(cartTotal);
		root.classList.toggle('qo-has-items', cartCount > 0);
	}

	function notify(message, kind) {
		var el = $('#qo-notice');
		el.textContent = message;
		el.className = 'qo-notice qo-notice-' + (kind || 'info');
		el.hidden = false;
		clearTimeout(notify.timer);
		notify.timer = setTimeout(function () { el.hidden = true; }, 4500);
	}

	/* --------------------------------------------------- نوشتن در سبد واقعی */

	var timers = {};

	function pushQuantity(row) {
		clearTimeout(timers[row.id]);
		timers[row.id] = setTimeout(function () {
			row.el.classList.add('qo-row-busy');

			var done = function (data) {
				row.el.classList.remove('qo-row-busy');
				readTotals(data);
			};
			var fail = function (err) {
				row.el.classList.remove('qo-row-busy');
				if (err && err.auth) { openDialog('#qo-auth'); row.quantity = 0; renderRow(row); return; }
				notify(err.message || 'ثبت تغییر ناموفق بود.', 'error');
				syncCart();
			};

			if (row.quantity <= 0 && row.cartItemId) {
				request('DELETE', API.cart + '/' + row.cartItemId).then(function (d) {
					row.cartItemId = null; done(d);
				}).catch(fail);
			} else if (row.cartItemId) {
				request('PUT', API.cart + '/' + row.cartItemId, { quantity: row.quantity }).then(done).catch(fail);
			} else if (row.quantity > 0) {
				request('POST', API.cart, { variant_id: row.variantId, quantity: row.quantity })
					.then(function (d) {
						var item = (d && (d.result || d.item)) || {};
						if (item.id) row.cartItemId = item.id;
						done(d);
						if (!row.cartItemId) syncCart();   // شناسهٔ ردیف را از سبد بگیر
					}).catch(fail);
			}
		}, CONFIG.debounce);
	}

	function setQuantity(row, value) {
		var q = parseInt(value, 10);
		if (isNaN(q) || q < 0) q = 0;

		var cap = row.max != null && row.max > 0 ? row.max : (row.stock != null && row.stock > 0 ? row.stock : null);
		if (cap != null && q > cap) {
			q = cap;
			notify('حداکثر تعداد مجاز ' + money(cap) + ' عدد است.', 'warn');
		}

		row.quantity = q;
		cartCount = rows.reduce(function (n, r) { return n + r.quantity; }, 0);
		cartTotal = rows.reduce(function (n, r) { return n + r.price * r.quantity; }, 0);
		renderRow(row);
		renderSummary();
		pushQuantity(row);
	}

	/* ------------------------------------------------- جست‌وجو / مرتب‌سازی */

	function applyView() {
		var query = ($('#qo-search').value || '').trim().toLowerCase();
		var onlyAvailable = $('#qo-available').checked;
		var sort = $('#qo-sort').value;
		var visible = 0;

		rows.forEach(function (row) {
			var match = !query || row.title.toLowerCase().indexOf(query) > -1;
			if (onlyAvailable && row.outofstock) match = false;
			row.el.hidden = !match;
			if (match) visible++;
		});

		if (sort !== 'default') {
			var container = $('#qo-rows');
			var sorted = rows.slice().sort(function (a, b) {
				if (sort === 'price-asc')  return (a.price || Infinity) - (b.price || Infinity);
				if (sort === 'price-desc') return (b.price || 0) - (a.price || 0);
				return a.title.localeCompare(b.title, 'fa');
			});
			sorted.forEach(function (r) { container.appendChild(r.el); });
		}

		$('#qo-empty').hidden = visible > 0;
	}

	function resetView() {
		$('#qo-search').value = '';
		$('#qo-available').checked = false;
		$('#qo-sort').value = 'default';
		applyView();
	}

	/* ---------------------------------------------------------- گفت‌وگوها */

	var pendingRemoval = null;

	function openDialog(sel) { $(sel).hidden = false; document.body.classList.add('qo-dialog-open'); }
	function closeDialog(sel) { $(sel).hidden = true; document.body.classList.remove('qo-dialog-open'); }

	/* ------------------------------------------------------------ رویدادها */

	root.addEventListener('click', function (e) {
		var btn = e.target.closest('button, a');
		if (!btn) return;
		var rowEl = e.target.closest('.qo-row');
		var row = rowEl ? rows.filter(function (r) { return r.el === rowEl; })[0] : null;

		if (btn.classList.contains('qo-add') && row) {
			if (isGuest) { openDialog('#qo-auth'); return; }
			if (!row.variantId) { notify('اطلاعات این کالا هنوز بارگذاری نشده؛ چند لحظه بعد دوباره تلاش کنید.', 'warn'); return; }
			setQuantity(row, 1);
		} else if (btn.classList.contains('qo-step') && row) {
			var next = row.quantity + (btn.dataset.act === 'inc' ? 1 : -1);
			if (next <= 0) { pendingRemoval = row; openDialog('#qo-confirm'); return; }
			setQuantity(row, next);
		} else if (btn.id === 'qo-confirm-yes') {
			closeDialog('#qo-confirm');
			if (pendingRemoval) { setQuantity(pendingRemoval, 0); pendingRemoval = null; }
		} else if (btn.id === 'qo-confirm-no') {
			closeDialog('#qo-confirm'); pendingRemoval = null;
		} else if (btn.id === 'qo-auth-close') {
			closeDialog('#qo-auth');
		} else if (btn.id === 'qo-reset') {
			resetView();
		}
	});

	root.addEventListener('change', function (e) {
		if (e.target.id === 'qo-sort' || e.target.id === 'qo-available') applyView();
		else if (e.target.classList.contains('qo-variant')) {
			var rowEl = e.target.closest('.qo-row');
			var row = rows.filter(function (r) { return r.el === rowEl; })[0];
			if (!row) return;
			var v = row.variants.filter(function (x) { return String(x.id) === e.target.value; })[0];
			if (!v) return;
			if (row.quantity > 0) setQuantity(row, 0);   // تنوع قبلی از سبد برداشته شود
			row.variantId = v.id; row.price = v.price; row.stock = v.stock; row.max = v.max;
			row.cartItemId = null;
			renderRow(row);
		} else if (e.target.classList.contains('qo-qty')) {
			var el = e.target.closest('.qo-row');
			var r = rows.filter(function (x) { return x.el === el; })[0];
			if (r) setQuantity(r, e.target.value);
		}
	});

	var searchTimer;
	root.addEventListener('input', function (e) {
		if (e.target.id === 'qo-search') {
			clearTimeout(searchTimer);
			searchTimer = setTimeout(applyView, 180);
		} else if (e.target.classList.contains('qo-qty')) {
			var el = e.target.closest('.qo-row');
			var r = rows.filter(function (x) { return x.el === el; })[0];
			if (r && e.target.value !== '') setQuantity(r, e.target.value);
		}
	});

	document.addEventListener('keydown', function (e) {
		if (e.key !== 'Escape') return;
		if (!$('#qo-confirm').hidden) { closeDialog('#qo-confirm'); pendingRemoval = null; }
		if (!$('#qo-auth').hidden) closeDialog('#qo-auth');
	});

	window.QuickOrder = { debug: false, rows: rows, sync: syncCart };

	collectRows();
	renderSummary();
	hydrate().then(syncCart);
})();