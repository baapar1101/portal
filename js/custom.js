if (typeof $ == 'undefined')
	var $ = jQuery;

$(function(){
	/* loading */
	$('.loading').fadeOut();

	/* header */
	var header = $('.header');
	var headerHeight = header.outerHeight();
	$('body').css({'padding-top': headerHeight});


	var lastScrollTop = 40;
	
	$(window).scroll(function() {

		var st = $(this).scrollTop();

		if (st > lastScrollTop) {
			$('.header-menu').slideUp(200);
			$('.header-search-mobile').slideUp(200);
			header.addClass('scrolled');
		} else {
			$('.header-menu').slideDown(200);
			$('.header-search-mobile').slideDown(200);
			header.removeClass('scrolled');
		}
		lastScrollTop = st;
	});

	/* back to top */
	$('.footer-to-top-button').on('click', function(e) {
		e.preventDefault();
		$('html, body').animate({scrollTop:0}, '1000');
	});

	/* megaMenu */
	$('.navbar-mega-container').hover(function(e) {
		$('.mega-menu-title').addClass('hovered');
		$('.navbar-mega-context').show();
	},
	function() {
		$('.navbar-mega-context').hide();
		$('.mega-menu-title').removeClass('hovered');
	});

	/* progress */
	$('.products-offers-progress > span').css({"animation": "progress 6s linear infinite"});

	//  compare
    $('.store-compare-product-add').on('click', function() {

        $('.store-compare-quicksearch-query-input').focus();
    });
});