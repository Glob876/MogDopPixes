// Оригинальная иллюстрация для макета. Это не движок рисования редактора.
export const colors = [
  "#202c30",
  "#394b43",
  "#47684e",
  "#6e865b",
  "#a6b879",
  "#d3d9a0",
  "#f5e9c7",
  "#edc477",
  "#c48c50",
  "#986044",
  "#754c3e",
  "#cb7654",
  "#e49c71",
  "#98bac2",
  "#6f939d",
  "#466b7a",
  "#314c62",
  "#d6e2de",
  "#f7f6f2",
  "#b9bbb0",
  "#858a80",
  "#5f6b61",
  "#958273",
  "#bc9f87",
];

export function drawArtwork(
  canvas: HTMLCanvasElement,
  frame = 0,
  variant = "all",
): void {
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;

  function rectangle(
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
  ) {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  }

  function polygon(points: number[][], color: string) {
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        let inside = false;
        let previous = points.length - 1;
        for (let current = 0; current < points.length; current += 1) {
          const a = points[current];
          const b = points[previous];
          if (
            a[1] > y !== b[1] > y &&
            x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
          )
            inside = !inside;
          previous = current;
        }
        if (inside) rectangle(x, y, 1, 1, color);
      }
    }
  }

  function pine(x: number, y: number, height: number, color: string) {
    rectangle(x, y - 2, 2, 7, "#394b43");
    polygon(
      [
        [x + 1, y - height],
        [x - height / 3, y - 3],
        [x + height / 3 + 2, y - 3],
      ],
      color,
    );
    polygon(
      [
        [x + 1, y - height - 4],
        [x - height / 4, y - 9],
        [x + height / 4 + 2, y - 9],
      ],
      color,
    );
  }

  if (variant === "all" || variant === "sky") {
    rectangle(0, 0, 64, 64, "#d6e2de");
    rectangle(0, 22, 64, 19, "#c4d3c8");
    rectangle(41, 7, 9, 9, "#edc477");
    rectangle(39, 9, 13, 5, "#edc477");
    rectangle(7, 9, 14, 2, "#f5eee0");
    rectangle(10, 7, 7, 2, "#f5eee0");
    rectangle(26, 17, 11, 1, "#f5eee0");
    polygon(
      [
        [0, 32],
        [9, 18],
        [18, 31],
        [30, 13],
        [47, 36],
        [56, 22],
        [64, 32],
        [64, 45],
        [0, 45],
      ],
      "#98bac2",
    );
    polygon(
      [
        [21, 24],
        [30, 13],
        [37, 23],
        [31, 20],
        [28, 22],
        [27, 20],
      ],
      "#e4e8d9",
    );
    polygon(
      [
        [0, 38],
        [13, 27],
        [23, 37],
        [43, 24],
        [64, 38],
        [64, 47],
        [0, 47],
      ],
      "#6f939d",
    );
  }
  if (variant === "all" || variant === "ground") {
    rectangle(0, 40, 64, 24, "#47684e");
    polygon(
      [
        [0, 41],
        [10, 35],
        [20, 38],
        [37, 36],
        [48, 39],
        [64, 36],
        [64, 51],
        [0, 53],
      ],
      "#6e865b",
    );
    polygon(
      [
        [0, 56],
        [13, 49],
        [29, 47],
        [43, 49],
        [64, 45],
        [64, 64],
        [0, 64],
      ],
      "#394b43",
    );
    polygon(
      [
        [26, 48],
        [34, 47],
        [41, 52],
        [39, 56],
        [54, 61],
        [58, 64],
        [43, 64],
        [31, 58],
        [33, 53],
      ],
      "#98bac2",
    );
    rectangle(34 + (frame % 3), 53, 5, 1, "#d6e2de");
    rectangle(40 - (frame % 3), 60, 8, 1, "#6f939d");
    rectangle(35, 56, 3, 1, "#6f939d");
    pine(4, 45, 18, "#47684e");
    pine(13, 42, 15, "#47684e");
    pine(56, 46, 24, "#394b43");
    pine(62, 43, 15, "#47684e");
    pine(49, 45, 16, "#47684e");
    pine(3, 62, 22, "#202c30");
    pine(61, 61, 21, "#202c30");
    for (const [x, y] of [
      [11, 49],
      [17, 54],
      [45, 49],
      [53, 56],
      [23, 59],
      [16, 61],
    ]) {
      rectangle(x, y, 2, 1, "#a6b879");
      rectangle(x + 1, y - 1, 1, 1, "#6e865b");
    }
    rectangle(21, 49, 4, 2, "#858a80");
    rectangle(44, 55, 4, 2, "#858a80");
    rectangle(22, 49, 2, 1, "#b9bbb0");
  }
  if (variant === "all" || variant === "house") {
    rectangle(21, 35, 22, 13, "#986044");
    rectangle(23, 35, 19, 11, "#c48c50");
    rectangle(23, 38, 19, 1, "#986044");
    rectangle(23, 42, 19, 1, "#986044");
    rectangle(23, 46, 19, 1, "#754c3e");
    rectangle(37, 24, 4, 8, "#754c3e");
    rectangle(36, 23, 6, 2, "#986044");
    polygon(
      [
        [18, 36],
        [30, 24],
        [34, 24],
        [47, 36],
      ],
      "#754c3e",
    );
    polygon(
      [
        [20, 34],
        [30, 24],
        [34, 24],
        [44, 34],
      ],
      "#cb7654",
    );
    rectangle(22, 33, 21, 1, "#e49c71");
    rectangle(25, 30, 15, 1, "#e49c71");
    rectangle(28, 27, 9, 1, "#e49c71");
    rectangle(32, 38, 6, 10, "#754c3e");
    rectangle(33, 39, 4, 9, "#394b43");
    rectangle(36, 43, 1, 1, "#edc477");
    rectangle(25, 38, 5, 5, "#754c3e");
    rectangle(26, 39, 3, 3, "#edc477");
    rectangle(27, 39, 1, 3, "#c48c50");
    rectangle(25, 43, 5, 1, "#f5e9c7");
    rectangle(31, 48, 9, 2, "#b9bbb0");
    rectangle(32, 50, 9, 1, "#858a80");
    const shift = frame % 3;
    rectangle(38 + shift, 18 - shift, 3, 2, "#f5eee0");
    rectangle(40 + shift, 14 - shift, 4, 2, "#f5eee0");
  }
}
