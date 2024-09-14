window.addEventListener("load", init);
window.addEventListener("load", update);
window.addEventListener("keydown", (event) => {
  switch (event.key) {
    case "r": 
      update()
      break;
    case "1":
      togglePopup("keybind")
      break;
    case "2":
      togglePopup("help")
      break;
  }
});
window.addEventListener("mousemove", (e) => {
  if (should_draw) {
    let rect = mask_canvas.getBoundingClientRect();
    if (e.clientX < rect.x || e.clientX > rect.x + rect.width
      || e.clientY < rect.y || e.clientY > rect.y + rect.height
    ) {
      should_draw = false;
    }
  }
})

let file_dropped;


//TODO: tools to auto create the mask, and a checkmark to regenerate them with every sort
//     - Using the canvas drawing options, it would be easy to make multiple layers of generated masks
//     - 
//TODO: A history of sorted images that you can look back at, and save them
//     - Clear history button
//     - Show estimated size of history
//     - Delete specific history results
//     - Be able to export your whole history as a zip 
//     - 
//TODO: Be able to upload a zip file, sort every image, then export it, see above
//TODO: Limit file types you can upload, error checking, zip uploading


// Canvas that gets the image drawn onto scaled down to 50% of screen
let unsorted_canvas;
let unsorted_ctx;

// Canvas that gets the mask drawn onto;
//TODO: Undo array
let mask_canvas;
let mask_ctx;
let should_draw = false;
let brush_size = 30;
let brush_type = "brush";

const mask_history_max = 20;
let mask_history = [];

// The image gotten by the drag&drop event
let unsorted_image;

let overlays = new Map([
  ["help", false],
  ["keybind", false],
]);

// Canvas that gets the sorted image drawn ont scaled down
let sorted_canvas;
let sorted_ctx;
let sorted_images = [];

// In memory canvas to get the full image data and pixels
let memory_canvas;
let memory_ctx;

// Sorting function used by sort()
let pixel_sorting_function;

// Sorting function that defines the whole image sorting
// fn(ImageData) -> ImageData
let sorting_function;


function init() {
  // let tb = document.getElementById("history_list");
  // console.log(tb.rows);
  // console.log(tb.rows[0].cells);
  
  unsorted_canvas = document.getElementById("unsorted");
  unsorted_ctx = unsorted_canvas.getContext("2d");

  sorted_canvas = document.getElementById("sorted");
  sorted_ctx = sorted_canvas.getContext("2d");
  
  mask_canvas = document.getElementById("mask");
  mask_ctx = mask_canvas.getContext("2d");
  mask_ctx.fillStyle = "white";

  mask_canvas.addEventListener("mousedown", (ev) => { saveMaskHistory(); should_draw = true; drawOnMask(ev); } );
  mask_canvas.addEventListener("mousemove", (ev) => { drawOnMask(ev); } );
  mask_canvas.addEventListener("mouseup", (ev) => { should_draw = false } );

  document.getElementById("clear_mask").addEventListener("click", () => {
    saveMaskHistory();
    mask_canvas.width = mask_canvas.width;
  });

  document.getElementById("brush").addEventListener("click", () => {
    brush_type = "brush";
  });

  document.getElementById("eraser").addEventListener("click", () => {
    brush_type = "eraser";
  });

  document.getElementById("clear_history").addEventListener("click", () => {
    sorted_images = [];
    updateHistory();
  });

  document.getElementById("undo").addEventListener("click", () => {
    if (mask_history.length > 0) {
      let data = mask_history.shift();
      let scale
      mask_ctx.putImageData(data, 0, 0);
    }
  });

  document.getElementById("open_file").addEventListener("click", () => {
    let input = document.createElement("input");
    input.type = "file";

    input.onchange = events => {
      var file = events.target.files[0];
      if (file == null) {return;}
      file_dropped = file;

      var reader = new FileReader();
      reader.readAsDataURL(file);
      
      reader.onload = ev => {
        unsorted_image = new Image();
        unsorted_image.src = ev.target.result;
        update();
      }
    }

    input.click();
  });

  document.getElementById("download").addEventListener("click", () => {
    var a = document.createElement("a");
    a.href = memory_canvas.toDataURL("image/png", 1.0);
    a.download = "image.png"
    a.click();
  })

  document.getElementById("export_zip").addEventListener("click", async () => {
    if (sorted_images.length > 0) {
      let zipWriter = new zip.ZipWriter( new zip.BlobWriter("application/zip") );
      sorted_images.forEach( async (img) => {
          await zipWriter.add(img.name, new zip.BlobReader( img.data ));
      });

      let url = URL.createObjectURL(await zipWriter.close());

      var a = document.createElement("a");
      a.href = url;
      a.download = "images.zip"
      a.click();
    }
  });

  memory_canvas = document.createElement("canvas");
  memory_ctx = memory_canvas.getContext("2d");
  memory_canvas.width = 2;
  memory_canvas.height = 2;

  let slider = document.getElementById("brush_size")
  slider.addEventListener("input", () => {
      brush_size = slider.value;
      document.getElementById("brush_size_laber").innerHTML = `Brush size: ${slider.value}`;
  })

  //setInterval(update, 1000);
  setInterval(() => {
    //TODO: this is a horrible way to check if the image updated correctly, fix asap
    if (unsorted_image != null) {
      let text = document.getElementById("imagesize").innerText;
      if (text != null && text == `Image size: 0x0`) {
        update();
      }
    }
  }, 300);
}

function togglePopupOverlay(bool) {
  let popup = document.getElementById("popup_overlay")
  if (bool) {
    popup.style.visibility = "visible";
    popup.style.display = "block"; 
  } else {
    popup.style.visibility = "hidden";
    popup.style.display = "none"; 
  }
}

function togglePopup(key) {
  if (overlays.get(key)) {
    let d = document.getElementById(key);
    d.style.display = "none";
    overlays.set(key, false);
    togglePopupOverlay(false);
    return;
  }

  overlays.forEach( (v, k) => {
    let d = document.getElementById(k);
    d.style.display = "none"
    overlays.set(k, false);
  })

  let d = document.getElementById(key);
  d.style.display = "block";
  overlays.set(key, true);
  togglePopupOverlay(true);
  
}

function saveMaskHistory() {
  let data = mask_ctx.getImageData(0, 0, mask_canvas.width, mask_canvas.height);

  if (mask_history.length > mask_history_max) {
    mask_history.pop(); // Remove last history
  }
  
  mask_history.unshift(data); // Push as first element
  should_draw = false;
}

function drawOnMask(ev) {
  if (!should_draw) { return; }

  let pos = getMousePos(mask_canvas, ev);

  mask_ctx.fillStyle = "white";
  switch (brush_type) {
    case "brush":
      mask_ctx.globalCompositeOperation = "source-over";
      mask_ctx.fillRect(pos.x - brush_size/2.0, pos.y - brush_size/2.0, brush_size, brush_size);
      break;
    case "eraser":
      mask_ctx.globalCompositeOperation = "destination-out";
      mask_ctx.fillRect(pos.x - brush_size/2.0, pos.y - brush_size/2.0, brush_size, brush_size);
      break;
  }
}

function sortHorizontalImageWithMask(image_data) {
  let canvas = document.createElement("canvas");
  let ctx = canvas.getContext("2d");
  
  let reverse_mask = document.getElementById("reverse_mask").checked;
  
  canvas.width = image_data.width;
  canvas.height = image_data.height;
  
  ctx.drawImage(mask_ctx.canvas, 0, 0, canvas.width, canvas.height);
  let mask_data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  

  let pixel_lines = [];
  for (let height = 0; height < image_data.height; height++) {
    let line = [];
    for (let width = 0; width < image_data.width; width++) {
      let pixel = getPixel(image_data, width, height);
      pixel.x = width;
      pixel.y = height;
      line.push(pixel)
    }
    pixel_lines.push( line );
  }

  let pixel_lines_to_sort = [];

  pixel_lines.forEach(line => {
    // An array of pixels on a specific height of the image
    let line_to_sort = null;
    line.forEach(pixel => {
      let mask_p = (mask_data[pixel.y * image_data.width * 4 + pixel.x * 4 + 3] == 255);
      if (line_to_sort == null && mask_p != reverse_mask) {
        line_to_sort = {
          x: pixel.x,
          y: pixel.y,
          data: []
        }
      }

      if (line_to_sort != null && mask_p != reverse_mask) {
        line_to_sort.data.push(pixel);
      }

      if (line_to_sort != null && !mask_p != reverse_mask) {
        pixel_lines_to_sort.push( line_to_sort );
        line_to_sort = null;
      }
    }); 

    if (line_to_sort != null) {
        pixel_lines_to_sort.push( line_to_sort );
    }
  });

  pixel_lines_to_sort.forEach(line => {
    line.data.sort(pixel_sorting_function);
  })

  let pixels_raw = new Uint8ClampedArray(image_data.data.length);
  for (let height = 0; height < pixel_lines.length; height++) {
    const line = pixel_lines[height];
    for (let width = 0; width < line.length; width++) {
      pixels_raw[height * image_data.width * 4 + width * 4] = line[width].r;
      pixels_raw[height * image_data.width * 4 + width * 4 + 1] = line[width].g;
      pixels_raw[height * image_data.width * 4 + width * 4 + 2] = line[width].b;
      pixels_raw[height * image_data.width * 4 + width * 4 + 3] = line[width].a;
    } 
  }

  pixel_lines_to_sort.forEach( line => {
    for (let width = 0; width < line.data.length; width++) {
      pixels_raw[line.y * image_data.width * 4 + line.x * 4 + width * 4] = line.data[width].r;
      pixels_raw[line.y * image_data.width * 4 + line.x * 4 + width * 4 + 1] = line.data[width].g;
      pixels_raw[line.y * image_data.width * 4 + line.x * 4 + width * 4 + 2] = line.data[width].b;
      pixels_raw[line.y * image_data.width * 4 + line.x * 4 + width * 4 + 3] = line.data[width].a;
    }
  });

  return new ImageData(pixels_raw ,image_data.width, image_data.height)
}

function sortWholeImageWithMask(image_data) {
    let canvas = document.createElement("canvas");
    let ctx = canvas.getContext("2d");

    let reverse_mask = document.getElementById("reverse_mask").checked;

    canvas.width = image_data.width;
    canvas.height = image_data.height;

    ctx.drawImage(mask_ctx.canvas, 0, 0, canvas.width, canvas.height);
    let mask_data = ctx.getImageData(0, 0, canvas.width, canvas.height);

    let pixels = [];
    for (let i = 0; i < image_data.data.length / 4; i++) {
        if ( (mask_data.data[i * 4 + 3] == 255) != reverse_mask ) {
          // TODO: separate pixel creation into a function, so we abstract the hsv and all ther color stuff
          pixels.push( getPixelX(image_data, i) ); 
        }
    }

    pixels.sort(pixel_sorting_function);

    let sorted_pixels_raw = new Uint8ClampedArray(image_data.data.length);
    let mask_ctr = 0;

    for (let i= 0; i < image_data.data.length / 4; i++) {
      if ( (mask_data.data[i * 4 + 3] == 255) != reverse_mask) {
        sorted_pixels_raw[i * 4]     = pixels[mask_ctr].r
        sorted_pixels_raw[i * 4 + 1] = pixels[mask_ctr].g
        sorted_pixels_raw[i * 4 + 2] = pixels[mask_ctr].b
        sorted_pixels_raw[i * 4 + 3] = pixels[mask_ctr].a
        mask_ctr++;
      } else {
        sorted_pixels_raw[i * 4]     = image_data.data[i * 4];
        sorted_pixels_raw[i * 4 + 1] = image_data.data[i * 4 + 1]
        sorted_pixels_raw[i * 4 + 2] = image_data.data[i * 4 + 2]
        sorted_pixels_raw[i * 4 + 3] = image_data.data[i * 4 + 3]
      }
    }


    return new ImageData(sorted_pixels_raw ,image_data.width, image_data.height)
}

function sortImage() {
    if (file_dropped == null) {
      return;
    }

    let reverse_box = document.getElementById("reverse_fn").checked;

    // Check what sorting algorithm to use
    const p_sorting_fn = document.getElementById("p_sorting_fn");
    switch (p_sorting_fn.value) {
      case "red": 
        if (reverse_box) { pixel_sorting_function = sortByRedRev; }
        else { pixel_sorting_function = sortByRed; }
      break;
      case "green": 
        if (reverse_box) { pixel_sorting_function = sortByGreenRev; }
        else { pixel_sorting_function = sortByGreen; }
      break;
      case "blue": 
        if (reverse_box) { pixel_sorting_function = sortByBlueRev; }
        else { pixel_sorting_function = sortByBlue; }
      break;
      case "hue": 
        if (reverse_box) { pixel_sorting_function = sortByHueRev; }
        else { pixel_sorting_function = sortByHue; }
      break;
      case "saturation": 
        if (reverse_box) { pixel_sorting_function = sortBySaturationRev; }
        else { pixel_sorting_function = sortBySaturation; }
      break;
      case "lightness": 
        if (reverse_box) { pixel_sorting_function = sortByLightnessRev; }
        else { pixel_sorting_function = sortByLightness; }
      break;
    }

    const sorting_fn = document.getElementById("sorting_fn");
    switch (sorting_fn.value) {
      case "whole": sorting_function = sortWholeImageWithMask; break;
      case "horizontal": sorting_function = sortHorizontalImageWithMask; break;
      case "vertical": sorting_function = sortWholeImage; break;
    }


    // Draw the full image to a new canvas
    memory_canvas.width = unsorted_image.width;
    memory_canvas.height = unsorted_image.height;
    memory_ctx.drawImage(unsorted_image, 0, 0);
    
    // We drew the image, now we can get the imageData from the canvas
    let image_data = memory_ctx.getImageData(0, 0, memory_canvas.width, memory_canvas.height);

    let start = Date.now();
    let data = sorting_function(image_data);
    let end = Date.now()
    memory_ctx.putImageData(data, 0, 0);
    document.getElementById("timer").innerText = `Time to sort: ${end - start}ms`;

    memory_canvas.toBlob( (blob) => {
      let name = file_dropped.name.replace(/\.[^/.]+$/, "");
      sorted_images.push({
        name: `${name}${(Math.random() * 1000).toFixed(0)}.png`,
        data: blob,
      });
      updateHistory();
    })
    update();
}

function updateHistory() {
  let t = document.createElement("table");
  let tb = document.getElementById("history_list")
  let tbody = tb.getElementsByTagName('tbody')[0];

  // Clear all previous rows
  tbody.innerHTML = "";


  let total_size = 0;
  // Recreate the table
  for (let i = 0; i < sorted_images.length; i++) {
    const img = sorted_images[i];
    
    // Image name
    let curr_row = tbody.insertRow();
    //TODO: have differing names for images, with an extra number or something
    curr_row.insertCell().innerHTML = img.name;

    // Image size
    let size = img.data.size * 0.000001; // size in megabytes
    total_size += size;
    curr_row.insertCell().innerHTML = `${size.toFixed(2)}MB`;

    // Image delete button
    let b1 = document.createElement("button");
    b1.textContent = "Delete";
    b1.onclick = ev => {
      sorted_images.splice(i, 1);
      updateHistory();
    }
    curr_row.insertCell().appendChild( b1 );

    // Image save button
    //TODO: finish image save button
    let b2 = document.createElement("button");
    b2.textContent = "Save";
    b2.onclick = ev => {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(img.data);
      a.download = "image.png"
      a.click();
    }
    curr_row.insertCell().appendChild( b2 );

    //TODO: Dropdown window on title that shows the image in big
  }

  document.getElementById("total_size").innerHTML = `Total size is ${total_size.toFixed(2)}MB`
}
  
function update() {
  if (unsorted_image != null) {
    document.getElementById("imagesize").innerText = `Image size: ${unsorted_image.width}x${unsorted_image.height}`;
  }

  const rect = document.getElementById("canvas1").getBoundingClientRect();
  unsorted_canvas.width = rect.width;
  unsorted_canvas.height = rect.height;

  let cv = document.createElement("canvas");
  cv.width = mask_canvas.width;
  cv.height = mask_canvas.height;
  let ctx = cv.getContext("2d");
  ctx.drawImage(mask_ctx.canvas, 0, 0, cv.width, cv.height);

  mask_canvas.width = rect.width;
  mask_canvas.height = rect.height;

  mask_ctx.drawImage(ctx.canvas, 0, 0, mask_canvas.width, mask_canvas.height);



  sorted_canvas.width = rect.width;
  sorted_canvas.height = rect.height;
  draw()
}
    
function draw() {
    if (unsorted_image != null) {
      unsorted_ctx.drawImage(unsorted_image, 0, 0, unsorted_canvas.width, unsorted_canvas.height);
      sorted_ctx.drawImage(memory_ctx.canvas, 0, 0, sorted_canvas.width, sorted_canvas.height);
    }
}

function dropOverHandler(ev) {
  ev.preventDefault();
  ev.stopPropagation();
}

function dropHandler(ev) {
  ev.preventDefault();
  ev.stopPropagation();

  // Prevent default behavior (Prevent file from being opened)

  if (ev.dataTransfer.items) {
    [...ev.dataTransfer.items].forEach((item, i) => {
      // If dropped items aren't files, reject them
      if (item.kind === "file") {
        file_dropped = item.getAsFile();
      }
    });
  } else {
    // Use DataTransfer interface to access the file(s)
    [...ev.dataTransfer.files].forEach((file, i) => {
        file_dropped = file;
    });
  }
  if (file_dropped != null) {
    let reader = new FileReader();
    unsorted_image = new Image()
    reader.onload = ev => {
        //FIXME: Figure out why sometimes the reader result is not drawn
        unsorted_image.src = ev.target.result;
        update();
    }
    reader.readAsDataURL(file_dropped);
  }

}

function getMousePos(canvas, evt) {
    let rect = canvas.getBoundingClientRect();
    return {
        x: (evt.clientX - rect.left) / (rect.right - rect.left) * canvas.width,
        y: (evt.clientY - rect.top) / (rect.bottom - rect.top) * canvas.height
    };
}
function rgb2hsl(r, g, b) {
 r /= 255;
  g /= 255;
  b /= 255;

  // Find greatest and smallest channel values
  let cmin = Math.min(r,g,b),
      cmax = Math.max(r,g,b),
      delta = cmax - cmin,
      h = 0,
      s = 0,
      l = 0;

  if (delta == 0)
    h = 0;
  // Red is max
  else if (cmax == r)
    h = ((g - b) / delta) % 6;
  // Green is max
  else if (cmax == g)
    h = (b - r) / delta + 2;
  // Blue is max
  else
    h = (r - g) / delta + 4;

  h = Math.round(h * 60);
    
  // Make negative hues positive behind 360°
  if (h < 0)
      h += 360;

  l = (cmax + cmin) / 2;

  // Calculate saturation
  s = delta == 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    
  // Multiply l and s by 100
  s = +(s * 100).toFixed(1);
  l = +(l * 100).toFixed(1);

  return {h: h, s: s, l: l};
}

function getPixelX(img, x) {
  let r = img.data[x * 4];
  let g = img.data[x * 4 + 1];
  let b = img.data[x * 4 + 2];
  let a = img.data[x * 4 + 3];

  let hsl = rgb2hsl(r, g, b);

  return {
    r: r,
    g: g,
    b: b,
    a: a,
    h: hsl.h,
    s: hsl.s,
    l: hsl.l
  }
}

function getPixel(img, x, y) {
  let r = img.data[img.width * y * 4 + x * 4];
  let g = img.data[img.width * y * 4 + x * 4 + 1];
  let b = img.data[img.width * y * 4 + x * 4 + 2];
  let a = img.data[img.width * y * 4 + x * 4 + 3];

  let hsl = rgb2hsl(r, g, b);

  return {
    r: r,
    g: g,
    b: b,
    a: a,
    h: hsl.h,
    s: hsl.s,
    l: hsl.l
  }
}
