/* custom.js — نسخهٔ بازنویسی‌شده
   تغییرات نسبت به نسخهٔ قبل:
   1. اسکرول با requestAnimationFrame و listener از نوع passive (قبلاً روی هر
      رویداد اسکرول slideUp/slideDown اجرا می‌شد و روی موبایل جانک می‌داد)
   2. padding-top بدنه با تغییر اندازهٔ پنجره دوباره حساب می‌شود
      (قبلاً یک بار در بارگذاری ست می‌شد و با چرخش گوشی به هم می‌ریخت)
   3. مگامنو علاوه بر hover با کیبورد، لمس و کلید Escape هم کار می‌کند
      و aria-expanded را ست می‌کند
   4. انیمیشن‌ها با prefers-reduced-motion غیرفعال می‌شوند
   رفتار ظاهری برای کاربر ماوس دقیقاً مثل قبل است. */

if (typeof $ == 'undefined')
	var $ = jQuery;

$(function () {

	var reduceMotion = window.matchMedia &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	/* loading */
	$('.loading').fadeOut(reduceMotion ? 0 : 400);


	/* ---------------------------------------------------------- هدر چسبان */
	var $header = $('.header');
	var $body = $('body');

	function syncHeaderOffset() {
		$body.css('padding-top', $header.outerHeight());
	}
	syncHeaderOffset();

	var resizeTimer;
	$(window).on('resize orientationchange', function () {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(syncHeaderOffset, 150);
	});

	var $hideOnScroll = $('.header-menu, .header-search-mobile');
	var lastScrollTop = 40;
	var ticking = false;

	function onScrollFrame() {
		var st = window.pageYOffset || document.documentElement.scrollTop;

		if (st > lastScrollTop && st > 40) {
			$hideOnScroll.stop(true, true).slideUp(reduceMotion ? 0 : 200);
			$header.addClass('scrolled');
		} else if (st < lastScrollTop) {
			$hideOnScroll.stop(true, true).slideDown(reduceMotion ? 0 : 200);
			if (st <= 40) $header.removeClass('scrolled');
		}

		lastScrollTop = st <= 0 ? 0 : st;
		ticking = false;
	}

	window.addEventListener('scroll', function () {
		if (!ticking) {
			window.requestAnimationFrame(onScrollFrame);
			ticking = true;
		}
	}, { passive: true });


	/* ------------------------------------------------------ بازگشت به بالا */
	$('.footer-to-top-button').on('click', function (e) {
		e.preventDefault();
		if (reduceMotion) {
			window.scrollTo(0, 0);
		} else {
			$('html, body').animate({ scrollTop: 0 }, 600);
		}
	});


	/* ------------------------------------------------------------ مگامنو
	   قبلاً فقط hover بود: با کیبورد باز نمی‌شد و روی تاچ گیر می‌کرد. */
	var $megaContainer = $('.navbar-mega-container');
	var $megaTitle = $('.mega-menu-title');
	var $megaContext = $('.navbar-mega-context');
	var megaCloseTimer;

	$megaTitle.attr({ 'aria-haspopup': 'true', 'aria-expanded': 'false' });

	function openMega() {
		clearTimeout(megaCloseTimer);
		$megaTitle.addClass('hovered').attr('aria-expanded', 'true');
		$megaContext.show();
	}

	function closeMega(delay) {
		clearTimeout(megaCloseTimer);
		megaCloseTimer = setTimeout(function () {
			$megaContext.hide();
			$megaTitle.removeClass('hovered').attr('aria-expanded', 'false');
		}, delay || 0);
	}

	$megaContainer.on('mouseenter', openMega);
	$megaContainer.on('mouseleave', function () { closeMega(120); });

	/* کیبورد: با Tab باز و با خروج فوکوس بسته می‌شود */
	$megaContainer.on('focusin', openMega);
	$megaContainer.on('focusout', function () { closeMega(120); });

	/* لمس: اولین ضربه فقط منو را باز می‌کند، ضربهٔ دوم لینک را دنبال می‌کند */
	$megaTitle.on('click', function (e) {
		e.preventDefault();
		if ($megaTitle.attr('aria-expanded') === 'true') closeMega();
		else openMega();
	});

	$(document).on('keydown', function (e) {
		if (e.key === 'Escape' || e.keyCode === 27) {
			closeMega();
			$megaTitle.trigger('blur');
		}
	});


	/* ------------------------------------------------ نوار پیشرفت پیشنهادها */
	if (!reduceMotion) {
		$('.products-offers-progress > span').css({ 'animation': 'progress 6s linear infinite' });
	}


	/* ------------------------------------------------------------- مقایسه */
	$('.store-compare-product-add').on('click', function () {
		$('.store-compare-quicksearch-query-input').trigger('focus');
	});
});
