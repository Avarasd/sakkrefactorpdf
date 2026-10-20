// LinkedIn Carousel Navigation & Multi-Page PDF / Image Export

document.addEventListener('DOMContentLoaded', () => {
  let currentSlideIndex = 1;
  const totalSlides = 4;
  let isCarouselMode = true;

  const slides = document.querySelectorAll('.carousel-slide');
  const slidesContainer = document.getElementById('slidesContainer');
  const slideIndicator = document.getElementById('slideIndicator');
  const prevBtn = document.getElementById('prevSlideBtn');
  const nextBtn = document.getElementById('nextSlideBtn');
  const toggleViewBtn = document.getElementById('toggleViewBtn');
  const btnExportPdf = document.getElementById('btnExportPdf');
  const btnPrintVector = document.getElementById('btnPrintVector');
  const btnExportPng = document.getElementById('btnExportCurrentPng');

  // Slide navigation
  function showSlide(index) {
    if (!isCarouselMode) return;
    currentSlideIndex = Math.max(1, Math.min(totalSlides, index));
    
    slides.forEach(slide => {
      const idx = parseInt(slide.dataset.slideIndex, 10);
      if (idx === currentSlideIndex) {
        slide.classList.add('active');
      } else {
        slide.classList.remove('active');
      }
    });

    if (slideIndicator) {
      slideIndicator.textContent = `Slide ${currentSlideIndex} of ${totalSlides}`;
    }
  }

  function nextSlide() {
    if (currentSlideIndex < totalSlides) {
      showSlide(currentSlideIndex + 1);
    } else {
      showSlide(1); // loop back
    }
  }

  function prevSlide() {
    if (currentSlideIndex > 1) {
      showSlide(currentSlideIndex - 1);
    } else {
      showSlide(totalSlides);
    }
  }

  if (prevBtn) prevBtn.addEventListener('click', prevSlide);
  if (nextBtn) nextBtn.addEventListener('click', nextSlide);

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') nextSlide();
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevSlide();
  });

  // URL hash check (e.g. #slide-2)
  if (window.location.hash.startsWith('#slide-')) {
    const s = parseInt(window.location.hash.replace('#slide-', ''), 10);
    if (!isNaN(s)) showSlide(s);
  }

  // Toggle between Carousel (1 slide at a time) and Stacked view (all slides)
  if (toggleViewBtn) {
    toggleViewBtn.addEventListener('click', () => {
      isCarouselMode = !isCarouselMode;
      if (isCarouselMode) {
        slidesContainer.classList.add('carousel-mode');
        toggleViewBtn.innerHTML = '<span>📑 Mode: Carousel</span>';
        showSlide(currentSlideIndex);
      } else {
        slidesContainer.classList.remove('carousel-mode');
        toggleViewBtn.innerHTML = '<span>📜 Mode: All Slides</span>';
        if (slideIndicator) slideIndicator.textContent = 'All 4 Slides';
      }
    });
  }

  // Native Vector PDF via System Print (Cmd + P)
  if (btnPrintVector) {
    btnPrintVector.addEventListener('click', () => {
      const wasCarouselMode = isCarouselMode;
      // Temporarily reveal all slides for clean multi-page print
      slidesContainer.classList.remove('carousel-mode');
      
      window.print();
      
      if (wasCarouselMode) {
        slidesContainer.classList.add('carousel-mode');
        showSlide(currentSlideIndex);
      }
    });
  }

  // 1-Click Export: LinkedIn Multi-Page PDF Carousel (4 Pages, 4:5 ratio)
  if (btnExportPdf) {
    btnExportPdf.addEventListener('click', async () => {
      const originalText = btnExportPdf.innerHTML;
      btnExportPdf.innerHTML = '<span>⏳ Rendering PDF (Page 1/4)...</span>';
      btnExportPdf.style.opacity = '0.7';
      btnExportPdf.style.pointerEvents = 'none';

      try {
        if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
          alert('Libraries are still loading. Please wait a few seconds and try again.');
          btnExportPdf.innerHTML = originalText;
          btnExportPdf.style.opacity = '1';
          btnExportPdf.style.pointerEvents = 'auto';
          return;
        }

        const { jsPDF } = window.jspdf;
        // Standard LinkedIn 4:5 aspect ratio (1080 x 1350 px)
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'px',
          format: [1080, 1350]
        });

        // Ensure all fonts are fully loaded and measured before capture
        if (document.fonts) {
          await document.fonts.ready;
        }

        // Ensure all slides are temporarily visible for rendering
        const wasCarouselMode = isCarouselMode;
        slidesContainer.classList.remove('carousel-mode');

        for (let i = 0; i < slides.length; i++) {
          const slide = slides[i];
          btnExportPdf.innerHTML = `<span>⏳ Rendering Slide ${i + 1} of ${totalSlides}...</span>`;

          const canvas = await html2canvas(slide, {
            scale: 2.5, // Ultra-high resolution crisp capture
            useCORS: true,
            backgroundColor: '#0b0f19',
            logging: false,
            imageTimeout: 15000
          });

          const imgData = canvas.toDataURL('image/jpeg', 0.98);
          if (i > 0) {
            pdf.addPage([1080, 1350], 'portrait');
          }
          pdf.addImage(imgData, 'JPEG', 0, 0, 1080, 1350, undefined, 'FAST');
        }

        // Restore view mode
        if (wasCarouselMode) {
          slidesContainer.classList.add('carousel-mode');
          showSlide(currentSlideIndex);
        }

        pdf.save('chess-refactoring-linkedin-carousel.pdf');

        btnExportPdf.innerHTML = '<span>✅ PDF Downloaded!</span>';
        setTimeout(() => {
          btnExportPdf.innerHTML = originalText;
          btnExportPdf.style.opacity = '1';
          btnExportPdf.style.pointerEvents = 'auto';
        }, 2500);

      } catch (err) {
        console.error('PDF export failed:', err);
        alert('Could not generate PDF: ' + err.message + '\nTip: Use the "Print Native Vector PDF" button.');
        btnExportPdf.innerHTML = originalText;
        btnExportPdf.style.opacity = '1';
        btnExportPdf.style.pointerEvents = 'auto';
      }
    });
  }

  // Export Current Slide as Ultra-High-Res PNG (scale 3 for crystal clear text)
  if (btnExportPng) {
    btnExportPng.addEventListener('click', async () => {
      const activeSlide = isCarouselMode 
        ? document.querySelector('.carousel-slide.active') 
        : slides[currentSlideIndex - 1];

      if (!activeSlide) return;

      const originalText = btnExportPng.innerHTML;
      btnExportPng.innerHTML = '<span>⏳ Exporting...</span>';
      btnExportPng.style.opacity = '0.7';

      try {
        if (document.fonts) {
          await document.fonts.ready;
        }

        const canvas = await html2canvas(activeSlide, {
          scale: 3, // 3x crisp retina capture
          useCORS: true,
          backgroundColor: '#0b0f19',
          logging: false
        });

        const imageUri = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `chess-refactoring-slide-${activeSlide.dataset.slideIndex}.png`;
        link.href = imageUri;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        btnExportPng.innerHTML = '<span>✅ PNG Saved!</span>';
        setTimeout(() => {
          btnExportPng.innerHTML = originalText;
          btnExportPng.style.opacity = '1';
        }, 2000);
      } catch (err) {
        console.error('PNG export failed:', err);
        btnExportPng.innerHTML = originalText;
        btnExportPng.style.opacity = '1';
      }
    });
  }
});
