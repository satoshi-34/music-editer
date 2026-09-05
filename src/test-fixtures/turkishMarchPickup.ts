// 弱起（アウフタクト・Issue #473）の受入テスト用フィクスチャ。
// 元: 検聴セット ~/Developer/トルコ行進曲_8小節_検聴版.score.json（kern 校訂由来・2/4・8小節）。
// 弱起未対応のため先頭に足してあった 4 分休符（整形）を外し、measures[0].pickupBeats = 1 にしたもの。
// 運用者の実機環境には同内容の「トルコ行進曲_8小節_検聴版_弱起.score.json」がある。
import type { SavedScoreData } from '../types/storage';

export const turkishMarchPickupFixture = {
  "version": "1.0",
  "timestamp": 1788529571659,
  "metadata": {
    "title": "トルコ行進曲（K.331 第3楽章・弱起+8小節・検聴版・弱起）",
    "subtitle": "冒頭は休符+弱起（弱起の実装 #473 待ち）",
    "lyricist": "",
    "composer": "W. A. Mozart",
    "arranger": ""
  },
  "scoreType": "piano",
  "keySignature": "C",
  "timeSignature": [
    2,
    4
  ],
  "timeSignatureStyle": "numeric",
  "parts": [
    {
      "partId": "right-hand",
      "clef": "treble",
      "measures": [
        {
          "events": [
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "b/4"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "a/4"
              ],
              "dynamics": [
                {
                  "value": "p"
                }
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "g#/4"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "a/4"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "b/4"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "a/4"
                  ],
                  "dynamics": [
                    {
                      "value": "p"
                    }
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "g#/4"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "a/4"
                  ]
                }
              ]
            }
          ],
          "pickupBeats": 1
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/5"
              ]
            },
            {
              "dur": "8",
              "isRest": true,
              "keys": []
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "d/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "c/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "b/4"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "c/5"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": true,
                  "keys": []
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "d/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "c/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "b/4"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "c/5"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "e/5"
              ]
            },
            {
              "dur": "8",
              "isRest": true,
              "keys": []
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "f/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "e/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "d#/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "e/5"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "e/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": true,
                  "keys": []
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "f/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "e/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "d#/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "e/5"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "b/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "a/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "g#/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "a/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "b/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "a/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "g#/5"
              ]
            },
            {
              "dur": "16",
              "isRest": false,
              "keys": [
                "a/5"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "b/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "a/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "g#/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "a/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "b/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "a/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "g#/5"
                  ]
                },
                {
                  "dur": "16",
                  "isRest": false,
                  "keys": [
                    "a/5"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "4",
              "isRest": false,
              "keys": [
                "c/6"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "a/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/6"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "4",
                  "isRest": false,
                  "keys": [
                    "c/6"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "a/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/6"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "f#/5",
                "a/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "e/5",
                "g/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "f#/5",
                "a/5"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "f#/5",
                    "a/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "e/5",
                    "g/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "f#/5",
                    "a/5"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "f#/5",
                "a/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "e/5",
                "g/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "f#/5",
                "a/5"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "f#/5",
                    "a/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "e/5",
                    "g/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "f#/5",
                    "a/5"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "f#/5",
                "a/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "e/5",
                "g/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "d#/5",
                "f#/5"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "f#/5",
                    "a/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "e/5",
                    "g/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "d#/5",
                    "f#/5"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "4",
              "isRest": false,
              "keys": [
                "e/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/5",
                "e/5"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "d/5",
                "f/5"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "4",
                  "isRest": false,
                  "keys": [
                    "e/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/5",
                    "e/5"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "d/5",
                    "f/5"
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "partId": "left-hand",
      "clef": "bass",
      "measures": [
        {
          "events": [
            {
              "dur": "4",
              "isRest": true,
              "keys": []
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "4",
                  "isRest": true,
                  "keys": []
                }
              ]
            }
          ],
          "pickupBeats": 1
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "a/3"
              ],
              "pedalMark": "down"
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/4",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/4",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/4",
                "e/4"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "a/3"
                  ],
                  "pedalMark": "down"
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/4",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/4",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/4",
                    "e/4"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "a/3"
              ],
              "pedalMark": "down"
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/4",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/4",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/4",
                "e/4"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "a/3"
                  ],
                  "pedalMark": "down"
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/4",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/4",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/4",
                    "e/4"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "a/3"
              ],
              "pedalMark": "down"
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/4",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "a/3"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/4",
                "e/4"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "a/3"
                  ],
                  "pedalMark": "down"
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/4",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "a/3"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/4",
                    "e/4"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "a/3"
              ],
              "pedalMark": "down"
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/4",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/4",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "c/4",
                "e/4"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "a/3"
                  ],
                  "pedalMark": "down"
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/4",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/4",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "c/4",
                    "e/4"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "e/3"
              ],
              "pedalMark": "down"
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/3",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/3",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/3",
                "e/4"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "e/3"
                  ],
                  "pedalMark": "down"
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/3",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/3",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/3",
                    "e/4"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "e/3"
              ],
              "pedalMark": "down"
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/3",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/3",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/3",
                "e/4"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "e/3"
                  ],
                  "pedalMark": "down"
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/3",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/3",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/3",
                    "e/4"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "e/3"
              ],
              "pedalMark": "down"
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/3",
                "e/4"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/2"
              ]
            },
            {
              "dur": "8",
              "isRest": false,
              "keys": [
                "b/3"
              ]
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "e/3"
                  ],
                  "pedalMark": "down"
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/3",
                    "e/4"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/2"
                  ]
                },
                {
                  "dur": "8",
                  "isRest": false,
                  "keys": [
                    "b/3"
                  ]
                }
              ]
            }
          ]
        },
        {
          "events": [
            {
              "dur": "4",
              "isRest": false,
              "keys": [
                "e/3"
              ],
              "pedalMark": "down"
            },
            {
              "dur": "4",
              "isRest": true,
              "keys": []
            }
          ],
          "voices": [
            {
              "id": "voice-1",
              "events": [
                {
                  "dur": "4",
                  "isRest": false,
                  "keys": [
                    "e/3"
                  ],
                  "pedalMark": "down"
                },
                {
                  "dur": "4",
                  "isRest": true,
                  "keys": []
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "systems": 6,
  "measuresPerSystem": 4,
  "globalBpm": 120
} as unknown as SavedScoreData;
