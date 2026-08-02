/* quick-order.js — موتور «دفترچه سفارش سریع»
   ---------------------------------------------------------------------------
   عمداً وانیلا نوشته شده و به AngularJS دست نمی‌زند: باندل app.js موقع
   DOMContentLoaded خودش را bootstrap می‌کند و ثبت کنترلر بعد از آن قابل‌اعتماد
   نیست. این فایل فقط مستقیم با REST API خود سایت‌ساز حرف می‌زند:

     GET    /site/api/v1/search?q=&type=product
     GET    /site/api/v1/store/products/{id}
     POST   /site/api/v1/cart            { variant_id, quantity }

   ⚠ نقطه‌ای که باید یک بار با پاسخ واقعی سرور تطبیق داده شود: تابع‌های
   mapSearchItem و mapProduct پایین. نام فیلدها را از روی کاربرد موجود در قالب
   حدس زده‌ام (title / image / url / price / stock / variants). اگر ساختار
   پاسخ فرق داشت، فقط همین دو تابع را عوض کنید — بقیهٔ فایل دست‌نخورده می‌ماند.
   برای دیدن ساختار واقعی: در کنسول مرورگر QuickOrder.debug = true بگذارید. */

(function () {
	'use strict';

	var root = document.getElementById('qo-app');
	if (!root) return;

	var API = {
		search:  '/site/api/v1/search',
		product: '/site/api/v1/store/products/',
		cart:    '/site/api/v1/cart'
	};

	var CONFIG = {
		currency:      'تومان',
		storageKey:    'qo:draft:v1',
		searchDelay:   250,
		maxRows:       200,
		redirectAfter: '/cart'      // بعد از ثبت موفق
	};

	var state = { rows: [], busy: false, results: [], activeResult: -1 };

	/* ------------------------------------------------------------ کمکی‌ها */

	function $(sel, ctx) { return (ctx || root).querySelector(sel); }
	function cookie(name) {
		var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
		return m ? decodeURIComponent(m.pop()) : '';
	}

	/* هدر XSRF را دقیقاً مثل $http انگولار می‌فرستیم تا سرور درخواست را رد نکند */
	function request(method, url, body) {
		var headers = { 'Accept': 'application/json' };
		var token = cookie('XSRF-TOKEN');
		if (token) headers['X-XSRF-TOKEN'] = token;
		if (body) headers['Content-Type'] = 'application/json;charset=utf-8';

		return fetch(url, {
			method: method,
			headers: headers,
			credentials: 'same-origin',
			body: body ? JSON.stringify(body) : undefined
		}).then(function (res) {
			return res.json().catch(function () { return {}; }).then(function (data) {
				if (window.QuickOrder && window.QuickOrder.debug) console.log(method, url, data);
				if (!res.ok) throw new Error((data && (data.message || data.error)) || 'خطای سرور (' + res.status + ')');
				return data;
			});
		});
	}

	function money(value) {
		var n = Number(value) || 0;
		return n.toLocaleString('fa-IR');
	}

	function esc(str) {
		return String(str == null ? '' : str)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;')
			.replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	/* ------------------------------------- آداپتور پاسخ سرور (نقطهٔ تطبیق) */

	function mapSearchItem(raw) {
		return {
			id:        raw.id || raw.product_id || raw.productId,
			variantId: raw.variant_id || raw.variantId || null,
			title:     raw.title || raw.name || '',
			image:     raw.image || raw.thumbnail || '',
			url:       raw.url || '',
			sku:       raw.sku || raw.code || raw.barcode || '',
			price:     raw.price != null ? raw.price : null,
			stock:     raw.stock != null ? raw.stock : null
		};
	}

	function mapProduct(raw) {
		var p = (raw && raw.result) || raw || {};
		var variants = p.variants || p.variant || [];
		if (!Array.isArray(variants)) variants = [variants];
		return {
			id:      p.id,
			title:   p.title || p.name || '',
			image:   p.image || '',
			url:     p.url || '',
			variants: variants.map(function (v) {
				return {
					id:           v.id || v.variant_id,
					title:        v.title || v.name || '',
					price:        Number(v.price) || 0,
					comparePrice: Number(v.compare_price) || 0,
					stock:        v.stock == null ? null : Number(v.stock),
					sku:          v.sku || v.code || v.barcode || ''
				};
			})
		};
	}

	/* ------------------------------------------------------------ ردیف‌ها */

	function rowKey(productId, variantId) { return productId + ':' + (variantId || 0); }

	function findRow(productId, variantId) {
		var key = rowKey(productId, variantId);
		for (var i = 0; i < state.rows.length; i++) if (state.rows[i].key === key) return state.rows[i];
		return null;
	}

	function addProductById(productId, quantity, preferSku) {
		return request('GET', API.product + encodeURIComponent(productId)).then(function (data) {
			var p = mapProduct(data);
			if (!p.variants.length) throw new Error('این کالا تنوع قابل‌سفارشی ندارد.');

			var variant = p.variants[0];
			if (preferSku) {
				for (var i = 0; i < p.variants.length; i++) {
					if (p.variants[i].sku && String(p.variants[i].sku) === String(preferSku)) { variant = p.variants[i]; break; }
				}
			}
			pushRow(p, variant, quantity || 1);
		});
	}

	function pushRow(product, variant, quantity) {
		var existing = findRow(product.id, variant.id);
		if (existing) {
			setQuantity(existing, existing.quantity + (quantity || 1));
			flash(existing.key);
			return;
		}
		if (state.rows.length >= CONFIG.maxRows) {
			notify('بیش از ' + CONFIG.maxRows + ' ردیف در یک سفارش ممکن نیست.', 'error');
			return;
		}
		state.rows.unshift({
			key:       rowKey(product.id, variant.id),
			productId: product.id,
			variantId: variant.id,
			title:     product.title,
			image:     product.image,
			url:       product.url,
			variants:  product.variants,
			variantTitle: variant.title,
			price:        variant.price,
			comparePrice: variant.comparePrice,
			stock:        variant.stock,
			sku:          variant.sku,
			quantity:     Math.max(1, quantity || 1),
			status:       ''
		});
		render();
		save();
		notify('«' + product.title + '» اضافه شد.', 'success');
	}

	function setQuantity(row, value) {
		var q = parseInt(value, 10);
		if (isNaN(q) || q < 1) q = 1;
		if (row.stock != null && row.stock > 0 && q > row.stock) {
			q = row.stock;
			notify('موجودی «' + row.title + '» ' + money(row.stock) + ' عدد است.', 'warn');
		}
		row.quantity = q;
		render();
		save();
	}

	function removeRow(key) {
		state.rows = state.rows.filter(function (r) { return r.key !== key; });
		render();
		save();
	}

	function switchVariant(row, variantId) {
		var v = row.variants.filter(function (x) { return String(x.id) === String(variantId); })[0];
		if (!v) return;
		removeRow(row.key);
		pushRow({ id: row.productId, title: row.title, image: row.image, url: row.url, variants: row.variants }, v, row.quantity);
	}

	/* ------------------------------------------------------------ ذخیره */

	function save() {
		try {
			localStorage.setItem(CONFIG.storageKey, JSON.stringify(state.rows));
		} catch (e) { /* حالت ناشناس مرورگر — بی‌خیال */ }
	}

	function restore() {
		try {
			var raw = localStorage.getItem(CONFIG.storageKey);
			if (raw) state.rows = JSON.parse(raw) || [];
		} catch (e) { state.rows = []; }
	}

	/* ------------------------------------------------------------ جست‌وجو */

	var searchTimer;
	function runSearch(query) {
		clearTimeout(searchTimer);
		if (!query || query.length < 2) { state.results = []; renderResults(); return; }
		searchTimer = setTimeout(function () {
			request('GET', API.search + '?type=product&q=' + encodeURIComponent(query))
				.then(function (data) {
					var list = (data && (data.result || data.results || data.items)) || [];
					state.results = list.map(mapSearchItem).filter(function (x) { return x.id; });
					state.activeResult = -1;
					renderResults();
				})
				.catch(function (err) { notify(err.message, 'error'); });
		}, CONFIG.searchDelay);
	}

	/* کد کالا / بارکد: اسکنر معمولاً کاراکترها را تایپ و بعد Enter می‌زند */
	function submitCode(code) {
		code = String(code || '').trim();
		if (!code) return;
		var input = $('#qo-code');
		input.disabled = true;

		request('GET', API.search + '?type=product&q=' + encodeURIComponent(code))
			.then(function (data) {
				var list = ((data && (data.result || data.results || data.items)) || []).map(mapSearchItem);
				if (!list.length) throw new Error('کالایی با کد «' + code + '» پیدا نشد.');
				var exact = list.filter(function (x) { return x.sku && String(x.sku) === code; })[0];
				return addProductById((exact || list[0]).id, 1, code);
			})
			.catch(function (err) { notify(err.message, 'error'); })
			.then(function () {
				input.disabled = false;
				input.value = '';
				input.focus();          // آمادهٔ اسکن بعدی
			});
	}

	/* --------------------------------------------------------- افزودن گروهی
	   هر خط: کد یا نام، سپس جداکنندهٔ (کاما / تب / فاصله) و تعداد */
	function bulkAdd(text) {
		var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
		if (!lines.length) return;

		var queue = lines.map(function (line) {
			var parts = line.split(/[,\t;]+|\s{2,}|\s+(?=\d+$)/);
			var qty = parseInt(parts[parts.length - 1], 10);
			var code = parts.length > 1 && !isNaN(qty) ? parts.slice(0, -1).join(' ').trim() : line;
			return { code: code, qty: !isNaN(qty) && parts.length > 1 ? qty : 1 };
		});

		var failed = [];
		setBusy(true, 'در حال افزودن ' + money(queue.length) + ' ردیف…');

		queue.reduce(function (chain, item) {
			return chain.then(function () {
				return request('GET', API.search + '?type=product&q=' + encodeURIComponent(item.code))
					.then(function (data) {
						var list = ((data && (data.result || data.results || data.items)) || []).map(mapSearchItem);
						if (!list.length) throw new Error(item.code);
						var exact = list.filter(function (x) { return x.sku && String(x.sku) === item.code; })[0];
						return addProductById((exact || list[0]).id, item.qty, item.code);
					})
					.catch(function () { failed.push(item.code); });
			});
		}, Promise.resolve()).then(function () {
			setBusy(false);
			$('#qo-bulk-text').value = '';
			toggleBulk(false);
			if (failed.length) notify('پیدا نشد: ' + failed.join('، '), 'error');
			else notify('همهٔ ردیف‌ها اضافه شدند.', 'success');
		});
	}

	/* ------------------------------------------------------ ثبت در سبد خرید */

	function submitOrder() {
		if (!state.rows.length || state.busy) return;
		var pending = state.rows.slice();
		var failed = [];
		setBusy(true, 'در حال ثبت ' + money(pending.length) + ' ردیف در سبد…');

		pending.reduce(function (chain, row) {
			return chain.then(function () {
				return request('POST', API.cart, { variant_id: row.variantId, quantity: row.quantity })
					.then(function () { row.status = 'ok'; })
					.catch(function (err) { row.status = 'error'; row.error = err.message; failed.push(row); })
					.then(function () { renderSummary(); });
			});
		}, Promise.resolve()).then(function () {
			setBusy(false);
			render();
			if (!failed.length) {
				try { localStorage.removeItem(CONFIG.storageKey); } catch (e) {}
				notify('سفارش در سبد ثبت شد. در حال انتقال…', 'success');
				setTimeout(function () { window.location.href = CONFIG.redirectAfter; }, 700);
			} else {
				notify(money(failed.length) + ' ردیف ثبت نشد. ردیف‌های قرمز را بررسی کنید.', 'error');
			}
		});
	}

	/* ------------------------------------------------------------- رندر */

	function totals() {
		var count = 0, sum = 0, compare = 0;
		state.rows.forEach(function (r) {
			count += r.quantity;
			sum += (Number(r.price) || 0) * r.quantity;
			compare += (Number(r.comparePrice) || Number(r.price) || 0) * r.quantity;
		});
		return { lines: state.rows.length, count: count, sum: sum, saved: Math.max(0, compare - sum) };
	}

	function render() {
		var body = $('#qo-rows');

		if (!state.rows.length) {
			body.innerHTML =
				'<div class="qo-empty">' +
					'<p class="qo-empty-title">هنوز کالایی اضافه نکرده‌اید</p>' +
					'<p class="qo-empty-hint">کد کالا را اسکن کنید یا نام آن را در کادر بالا بنویسید.</p>' +
				'</div>';
			renderSummary();
			return;
		}

		body.innerHTML = state.rows.map(function (r) {
			var lineTotal = (Number(r.price) || 0) * r.quantity;
			var lowStock = r.stock != null && r.stock > 0 && r.stock <= 5;

			var variantSelect = r.variants && r.variants.length > 1
				? '<select class="form-control qo-variant" data-key="' + esc(r.key) + '" aria-label="انتخاب تنوع">' +
					r.variants.map(function (v) {
						return '<option value="' + esc(v.id) + '"' + (String(v.id) === String(r.variantId) ? ' selected' : '') + '>' +
							esc(v.title || 'پیش‌فرض') + '</option>';
					}).join('') + '</select>'
				: (r.variantTitle ? '<span class="qo-variant-static">' + esc(r.variantTitle) + '</span>' : '');

			return '' +
			'<div class="qo-row' + (r.status === 'error' ? ' qo-row-error' : '') + (r.status === 'ok' ? ' qo-row-ok' : '') + '" data-key="' + esc(r.key) + '">' +
				'<div class="qo-cell qo-cell-product">' +
					(r.image ? '<img src="' + esc(r.image) + '?m=crop&w=96&h=96&q=high" class="qo-thumb" alt="" loading="lazy" decoding="async" width="96" height="96">' : '<span class="qo-thumb qo-thumb-empty"></span>') +
					'<div class="qo-product-text">' +
						(r.url ? '<a href="' + esc(r.url) + '" class="qo-title" target="_blank" rel="noopener">' + esc(r.title) + '</a>'
						       : '<span class="qo-title">' + esc(r.title) + '</span>') +
						(r.sku ? '<span class="qo-sku">کد: ' + esc(r.sku) + '</span>' : '') +
						variantSelect +
					'</div>' +
				'</div>' +
				'<div class="qo-cell qo-cell-price"><span class="qo-label">قیمت واحد</span><span class="qo-value">' + money(r.price) + '</span></div>' +
				'<div class="qo-cell qo-cell-qty">' +
					'<span class="qo-label">تعداد</span>' +
					'<div class="qo-stepper">' +
						'<button type="button" class="qo-step" data-act="dec" data-key="' + esc(r.key) + '" aria-label="کاهش تعداد">−</button>' +
						'<input type="number" class="qo-qty" value="' + r.quantity + '" min="1"' + (r.stock ? ' max="' + r.stock + '"' : '') + ' data-key="' + esc(r.key) + '" aria-label="تعداد ' + esc(r.title) + '" inputmode="numeric">' +
						'<button type="button" class="qo-step" data-act="inc" data-key="' + esc(r.key) + '" aria-label="افزایش تعداد">+</button>' +
					'</div>' +
					(lowStock ? '<span class="qo-stock-warn">تنها ' + money(r.stock) + ' عدد موجود</span>' : '') +
				'</div>' +
				'<div class="qo-cell qo-cell-total"><span class="qo-label">جمع ردیف</span><span class="qo-value qo-line-total">' + money(lineTotal) + '</span></div>' +
				'<div class="qo-cell qo-cell-action">' +
					'<button type="button" class="qo-remove" data-key="' + esc(r.key) + '" aria-label="حذف ' + esc(r.title) + '">حذف</button>' +
					(r.status === 'error' ? '<span class="qo-row-msg">' + esc(r.error || 'ثبت نشد') + '</span>' : '') +
				'</div>' +
			'</div>';
		}).join('');

		renderSummary();
	}

	function renderSummary() {
		var t = totals();
		$('#qo-sum-lines').textContent = money(t.lines);
		$('#qo-sum-count').textContent = money(t.count);
		$('#qo-sum-total').textContent = money(t.sum);
		var savedEl = $('#qo-sum-saved-wrap');
		if (t.saved > 0) { savedEl.hidden = false; $('#qo-sum-saved').textContent = money(t.saved); }
		else savedEl.hidden = true;
		$('#qo-submit').disabled = !t.lines || state.busy;
		$('#qo-clear').disabled = !t.lines || state.busy;
	}

	function renderResults() {
		var box = $('#qo-results');
		if (!state.results.length) { box.hidden = true; box.innerHTML = ''; return; }
		box.hidden = false;
		box.innerHTML = state.results.map(function (item, i) {
			return '<button type="button" class="qo-result' + (i === state.activeResult ? ' active' : '') + '" data-id="' + esc(item.id) + '" role="option">' +
				(item.image ? '<img src="' + esc(item.image) + '?m=crop&w=64&h=64&q=high" alt="" width="32" height="32" loading="lazy">' : '') +
				'<span class="qo-result-title">' + esc(item.title) + '</span>' +
				(item.sku ? '<span class="qo-result-sku">' + esc(item.sku) + '</span>' : '') +
			'</button>';
		}).join('');
	}

	function flash(key) {
		var el = root.querySelector('.qo-row[data-key="' + key + '"]');
		if (!el) return;
		el.classList.add('qo-row-flash');
		setTimeout(function () { el.classList.remove('qo-row-flash'); }, 700);
	}

	function notify(message, kind) {
		var el = $('#qo-notice');
		el.textContent = message;
		el.className = 'qo-notice qo-notice-' + (kind || 'info');
		el.hidden = false;
		clearTimeout(notify.timer);
		notify.timer = setTimeout(function () { el.hidden = true; }, 5000);
	}

	function setBusy(busy, message) {
		state.busy = busy;
		root.classList.toggle('qo-busy', busy);
		var bar = $('#qo-progress');
		bar.hidden = !busy;
		if (message) bar.textContent = message;
		renderSummary();
	}

	function toggleBulk(show) {
		var panel = $('#qo-bulk');
		panel.hidden = show === false ? true : (show === true ? false : !panel.hidden);
		if (!panel.hidden) $('#qo-bulk-text').focus();
	}

	/* ------------------------------------------------------------ رویدادها */

	root.addEventListener('click', function (e) {
		var t = e.target.closest('button');
		if (!t) return;

		if (t.classList.contains('qo-step')) {
			var row = state.rows.filter(function (r) { return r.key === t.dataset.key; })[0];
			if (row) setQuantity(row, row.quantity + (t.dataset.act === 'inc' ? 1 : -1));
		} else if (t.classList.contains('qo-remove')) {
			removeRow(t.dataset.key);
		} else if (t.classList.contains('qo-result')) {
			addProductById(t.dataset.id, 1).catch(function (err) { notify(err.message, 'error'); });
			$('#qo-search').value = '';
			state.results = []; renderResults();
			$('#qo-code').focus();
		} else if (t.id === 'qo-submit') {
			submitOrder();
		} else if (t.id === 'qo-clear') {
			if (confirm('همهٔ ردیف‌های این سفارش پاک شود؟')) { state.rows = []; render(); save(); }
		} else if (t.id === 'qo-bulk-toggle') {
			toggleBulk();
		} else if (t.id === 'qo-bulk-submit') {
			bulkAdd($('#qo-bulk-text').value);
		} else if (t.id === 'qo-bulk-cancel') {
			toggleBulk(false);
		}
	});

	root.addEventListener('input', function (e) {
		if (e.target.id === 'qo-search') runSearch(e.target.value);
		else if (e.target.classList.contains('qo-qty')) {
			var row = state.rows.filter(function (r) { return r.key === e.target.dataset.key; })[0];
			if (row) { row.quantity = Math.max(1, parseInt(e.target.value, 10) || 1); save(); renderSummary(); }
		}
	});

	root.addEventListener('change', function (e) {
		if (e.target.classList.contains('qo-variant')) {
			var row = state.rows.filter(function (r) { return r.key === e.target.dataset.key; })[0];
			if (row) switchVariant(row, e.target.value);
		} else if (e.target.classList.contains('qo-qty')) {
			var r2 = state.rows.filter(function (r) { return r.key === e.target.dataset.key; })[0];
			if (r2) setQuantity(r2, e.target.value);
		}
	});

	root.addEventListener('keydown', function (e) {
		if (e.target.id === 'qo-code' && e.key === 'Enter') {
			e.preventDefault();
			submitCode(e.target.value);
			return;
		}
		if (e.target.id === 'qo-search') {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				if (!state.results.length) return;
				state.activeResult += (e.key === 'ArrowDown' ? 1 : -1);
				if (state.activeResult < 0) state.activeResult = state.results.length - 1;
				if (state.activeResult >= state.results.length) state.activeResult = 0;
				renderResults();
			} else if (e.key === 'Enter') {
				e.preventDefault();
				var pick = state.results[state.activeResult < 0 ? 0 : state.activeResult];
				if (pick) {
					addProductById(pick.id, 1).catch(function (err) { notify(err.message, 'error'); });
					e.target.value = '';
					state.results = []; renderResults();
				}
			} else if (e.key === 'Escape') {
				state.results = []; renderResults();
			}
		}
	});

	/* بستن فهرست پیشنهادها با کلیک بیرون */
	document.addEventListener('click', function (e) {
		if (!e.target.closest('.qo-finder')) { state.results = []; renderResults(); }
	});

	/* هشدار خروج با سفارش نیمه‌کاره */
	window.addEventListener('beforeunload', function (e) {
		if (state.rows.length && !state.busy) { e.preventDefault(); e.returnValue = ''; }
	});

	window.QuickOrder = { debug: false, state: state };

	restore();
	render();
	var code = $('#qo-code');
	if (code && window.matchMedia('(min-width: 768px)').matches) code.focus();
})();
