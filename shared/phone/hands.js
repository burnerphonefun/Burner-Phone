// The hand holding the phone, per skin: a back layer (palm + sleeve, behind the phone)
// and a front layer (fingertips + thumb over the phone's edges). Our own art.
// Coordinates: viewBox 600x1000 laid over the phone (phone box ≈ x 80..466, y 0..806).

export const hands = {
  city: {
    back: `<svg class="bp-hand bp-hand-back" viewBox="0 0 600 1000" preserveAspectRatio="none"><defs>
      <linearGradient id="bpg-lb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d3a44"/><stop offset=".5" stop-color="#1d1c22"/><stop offset="1" stop-color="#0d0c10"/></linearGradient>
      <linearGradient id="bpg-sv" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#34445f"/><stop offset=".6" stop-color="#1b2436"/><stop offset="1" stop-color="#121826"/></linearGradient>
      <linearGradient id="bpg-cuff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d6f92"/><stop offset="1" stop-color="#2a3550"/></linearGradient></defs>
      <path d="M300 600 C380 538 480 556 532 626 C568 676 592 738 600 798 L600 1000 L250 1000 L246 828 C246 728 262 648 300 600Z" fill="url(#bpg-lb)"/>
      <path d="M470 610 C510 650 540 710 556 770" stroke="#56535f" stroke-width="3" fill="none" opacity=".55"/>
      <path d="M232 902 L600 856 L600 1000 L232 1000Z" fill="url(#bpg-sv)"/>
      <path d="M232 902 L600 856 L600 878 L234 926Z" fill="url(#bpg-cuff)" opacity=".9"/>
      <path d="M300 960 L560 930" stroke="#0e1320" stroke-width="2" opacity=".5"/>
    </svg>`,
    front: `<svg class="bp-hand bp-hand-front" viewBox="0 0 600 1000" preserveAspectRatio="none"><defs>
      <linearGradient id="bpg-lf" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4d4a56"/><stop offset=".35" stop-color="#25242b"/><stop offset="1" stop-color="#121116"/></linearGradient>
      <linearGradient id="bpg-lt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a5864"/><stop offset=".3" stop-color="#28272e"/><stop offset="1" stop-color="#0f0e12"/></linearGradient></defs>
      <g>
        <path d="M100 440 C100 424 86 416 72 418 C56 421 50 436 52 454 C54 474 62 490 78 494 C92 497 100 486 100 472Z" fill="url(#bpg-lf)"/>
        <path d="M100 512 C100 496 84 488 68 491 C52 495 46 511 48 530 C50 550 60 565 76 568 C91 570 100 558 100 544Z" fill="url(#bpg-lf)"/>
        <path d="M100 586 C100 571 85 563 70 566 C55 570 50 585 52 603 C54 621 63 635 78 637 C92 639 100 628 100 614Z" fill="url(#bpg-lf)"/>
        <path d="M100 656 C100 644 89 637 77 640 C65 643 61 655 63 669 C65 683 72 694 84 695 C95 696 100 687 100 676Z" fill="url(#bpg-lf)"/>
        <g stroke="#6e6c7a" stroke-width="1.6" fill="none" opacity=".5"><path d="M60 442 C64 432 74 426 84 426"/><path d="M56 516 C60 506 70 500 80 500"/><path d="M58 590 C62 580 72 574 82 574"/></g>
      </g>
      <path d="M548 836 C532 736 494 632 454 572 C434 542 408 536 400 556 C392 578 412 616 428 666 C442 716 452 786 460 856Z" fill="url(#bpg-lt)"/>
      <path d="M406 564 C412 550 428 546 442 556" stroke="#7d7b89" stroke-width="2.2" fill="none" opacity=".7"/>
      <path d="M420 616 C440 666 454 736 464 816" stroke="#5f5d69" stroke-width="1.6" stroke-dasharray="5 6" fill="none" opacity=".55"/>
    </svg>`,
  },
  blocky: {
    back: `<svg class="bp-hand bp-hand-back" viewBox="0 0 600 1000" preserveAspectRatio="none" shape-rendering="crispEdges">
      <rect x="250" y="640" width="300" height="420" fill="#b9825c"/>
      <rect x="250" y="640" width="300" height="40" fill="#c99470"/>
      <rect x="500" y="640" width="50" height="420" fill="#9a6a49"/>
      <rect x="270" y="700" width="20" height="20" fill="#a87553"/><rect x="380" y="760" width="20" height="20" fill="#a87553"/><rect x="320" y="840" width="20" height="20" fill="#d1a07c"/><rect x="450" y="900" width="20" height="20" fill="#a87553"/>
      <rect x="230" y="900" width="340" height="120" fill="#3b7fbf"/><rect x="230" y="900" width="340" height="24" fill="#4f95d6"/><rect x="520" y="900" width="50" height="120" fill="#2c6399"/>
    </svg>`,
    front: `<svg class="bp-hand bp-hand-front" viewBox="0 0 600 1000" preserveAspectRatio="none" shape-rendering="crispEdges">
      <rect x="420" y="600" width="86" height="190" fill="#c48d66"/><rect x="420" y="600" width="86" height="22" fill="#d6a37f"/><rect x="484" y="600" width="22" height="190" fill="#a06d4b"/>
      <rect x="436" y="650" width="16" height="16" fill="#b07a56"/>
      <rect x="56" y="470" width="46" height="64" fill="#c48d66"/><rect x="56" y="470" width="46" height="12" fill="#d6a37f"/>
      <rect x="56" y="552" width="46" height="64" fill="#c48d66"/><rect x="56" y="552" width="46" height="12" fill="#d6a37f"/>
      <rect x="60" y="634" width="42" height="58" fill="#c48d66"/><rect x="60" y="634" width="42" height="12" fill="#d6a37f"/>
    </svg>`,
  },
};
// a cartoon glove with thick outlines and a purple sleeve (battle-royale islands)
hands.toon = {
  back: `<svg class="bp-hand bp-hand-back" viewBox="0 0 600 1000" preserveAspectRatio="none">
    <path d="M300 600 C380 540 486 556 536 628 C570 678 594 740 600 800 L600 1000 L250 1000 L246 830 C246 730 262 650 300 600Z" fill="#fff" stroke="#1a1033" stroke-width="8"/>
    <path d="M226 900 L600 852 L600 1000 L226 1000Z" fill="#7b3cff" stroke="#1a1033" stroke-width="8"/>
    <path d="M226 900 L600 852 L600 884 L230 932Z" fill="#ffd23f" stroke="#1a1033" stroke-width="6"/>
    <path d="M330 960 L560 930" stroke="#5a24d6" stroke-width="10" stroke-linecap="round"/>
  </svg>`,
  front: `<svg class="bp-hand bp-hand-front" viewBox="0 0 600 1000" preserveAspectRatio="none">
    <g fill="#fff" stroke="#1a1033" stroke-width="7">
      <rect x="44" y="420" width="62" height="74" rx="30"/><rect x="40" y="500" width="66" height="76" rx="32"/>
      <rect x="42" y="582" width="64" height="70" rx="30"/><rect x="54" y="656" width="52" height="56" rx="24"/>
    </g>
    <path d="M552 846 C536 742 498 636 456 576 C434 544 404 538 396 560 C388 584 410 624 426 674 C440 724 450 794 458 864Z" fill="#fff" stroke="#1a1033" stroke-width="7"/>
    <path d="M410 600 C424 640 438 690 446 740" stroke="#c9c3e6" stroke-width="6" fill="none" stroke-linecap="round"/>
  </svg>`,
};
// a tactical glove with knuckle pads and a camo sleeve (bomb sites)
hands.tactical = {
  back: `<svg class="bp-hand bp-hand-back" viewBox="0 0 600 1000" preserveAspectRatio="none"><defs>
    <pattern id="bpg-camo" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="80" height="80" fill="#4b5236"/><path d="M0 20 Q20 0 40 18 T80 14 L80 34 Q60 46 40 36 T0 40Z" fill="#3a402a"/><path d="M10 60 Q30 46 50 58 T80 60 L80 76 Q50 84 20 74Z" fill="#62694a"/></pattern></defs>
    <path d="M300 600 C380 540 482 556 532 626 C568 676 592 738 600 798 L600 1000 L250 1000 L246 828 C246 728 262 648 300 600Z" fill="#2c3122"/>
    <rect x="300" y="640" width="200" height="38" rx="10" fill="#1d2117" transform="rotate(14 400 660)"/>
    <path d="M232 902 L600 856 L600 1000 L232 1000Z" fill="url(#bpg-camo)"/>
    <path d="M232 902 L600 856 L600 880 L234 926Z" fill="#23271b"/>
  </svg>`,
  front: `<svg class="bp-hand bp-hand-front" viewBox="0 0 600 1000" preserveAspectRatio="none">
    <g fill="#343a28"><rect x="48" y="422" width="56" height="70" rx="22"/><rect x="44" y="498" width="60" height="72" rx="24"/><rect x="46" y="576" width="58" height="66" rx="22"/><rect x="56" y="648" width="48" height="52" rx="18"/></g>
    <g fill="#1f2318"><rect x="52" y="436" width="28" height="22" rx="6"/><rect x="48" y="514" width="30" height="22" rx="6"/><rect x="50" y="590" width="28" height="20" rx="6"/></g>
    <path d="M548 840 C532 738 494 634 454 574 C434 544 408 538 400 558 C392 580 412 618 428 668 C442 718 452 788 460 858Z" fill="#343a28"/>
    <rect x="408" y="566" width="34" height="26" rx="7" fill="#1f2318" transform="rotate(-24 425 579)"/>
  </svg>`,
};
// a plastic toy arm with a mitten hand (block obby worlds)
hands.obby = {
  back: `<svg class="bp-hand bp-hand-back" viewBox="0 0 600 1000" preserveAspectRatio="none">
    <rect x="262" y="620" width="300" height="440" rx="60" fill="#ffd23f"/>
    <rect x="262" y="620" width="300" height="440" rx="60" fill="url(#bpg-obsh)" opacity=".5"/>
    <defs><linearGradient id="bpg-obsh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#b98a00" stop-opacity=".6"/></linearGradient></defs>
    <rect x="236" y="880" width="352" height="150" rx="24" fill="#2f7bff"/><rect x="236" y="880" width="352" height="26" rx="13" fill="#6ab0ff"/>
  </svg>`,
  front: `<svg class="bp-hand bp-hand-front" viewBox="0 0 600 1000" preserveAspectRatio="none">
    <rect x="40" y="440" width="70" height="250" rx="34" fill="#ffd23f"/><rect x="50" y="452" width="20" height="220" rx="10" fill="#fff" opacity=".45"/>
    <rect x="420" y="560" width="96" height="250" rx="46" fill="#ffd23f" transform="rotate(-14 468 685)"/>
  </svg>`,
};
// a bandaged hand in a leather sleeve (survival islands)
hands.survival = {
  back: `<svg class="bp-hand bp-hand-back" viewBox="0 0 600 1000" preserveAspectRatio="none">
    <path d="M300 600 C380 540 482 556 532 626 C568 676 592 738 600 798 L600 1000 L250 1000 L246 828 C246 728 262 648 300 600Z" fill="#b58663"/>
    <g stroke="#e8dcc4" stroke-width="22" opacity=".95"><path d="M262 700 L590 760"/><path d="M256 760 L596 812"/><path d="M252 820 L598 866"/></g>
    <g stroke="#b8a888" stroke-width="2" opacity=".7"><path d="M262 690 L590 750"/><path d="M256 750 L596 802"/></g>
    <path d="M226 904 L600 858 L600 1000 L226 1000Z" fill="#4a3322"/><path d="M226 904 L600 858 L600 876 L228 922Z" fill="#6b4a30"/>
    <g stroke="#2a1c12" stroke-width="3" stroke-dasharray="10 8"><path d="M250 940 L590 900"/></g>
  </svg>`,
  front: `<svg class="bp-hand bp-hand-front" viewBox="0 0 600 1000" preserveAspectRatio="none">
    <g fill="#b58663"><path d="M100 440 C100 424 86 416 72 418 C56 421 50 436 52 454 C54 474 62 490 78 494 C92 497 100 486 100 472Z"/><path d="M100 512 C100 496 84 488 68 491 C52 495 46 511 48 530 C50 550 60 565 76 568 C91 570 100 558 100 544Z"/><path d="M100 586 C100 571 85 563 70 566 C55 570 50 585 52 603 C54 621 63 635 78 637 C92 639 100 628 100 614Z"/><path d="M100 656 C100 644 89 637 77 640 C65 643 61 655 63 669 C65 683 72 694 84 695 C95 696 100 687 100 676Z"/></g>
    <g fill="#e8dcc4"><rect x="50" y="452" width="50" height="14" rx="5"/><rect x="48" y="526" width="52" height="14" rx="5"/></g>
    <path d="M548 840 C532 738 494 634 454 574 C434 544 408 538 400 558 C392 580 412 618 428 668 C442 718 452 788 460 858Z" fill="#b58663"/>
    <path d="M414 610 L452 600 M420 640 L458 630" stroke="#e8dcc4" stroke-width="12"/>
  </svg>`,
};
hands.default = hands.city;
