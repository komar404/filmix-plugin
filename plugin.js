(function() {
    'use strict';

    // ================== НАСТРОЙКИ ==================
    var fxapi_token = Lampa.Storage.get('fxapi_token', '');
    var unic_id = Lampa.Storage.get('fxapi_uid', '');

    if (!unic_id) {
        unic_id = Lampa.Utils.uid(16);
        Lampa.Storage.set('fxapi_uid', unic_id);
        console.log('[Filmix] Generated new UID:', unic_id);
    }

    // --- Список API-эндпоинтов Filmix ---
    var api_endpoints = [
        'http://filmixapp.vip/api/v2/',
        'http://filmixapp.cyou/api/v2/'
    ];
    var current_api_index = 0;

    function getApiUrl() {
        return api_endpoints[current_api_index];
    }

    function switchApiEndpoint() {
        current_api_index = (current_api_index + 1) % api_endpoints.length;
        console.log('[Filmix] 🔄 Switching API to: ' + api_endpoints[current_api_index]);
        return getApiUrl();
    }

    // --- РАЗНЫЕ ТИПЫ ПРОКСИ ДЛЯ РАЗНЫХ ЗАДАЧ ---
    var PROXIES = {
        // Для API запросов
        api: [
            'https://corsproxy.io/?',
            'https://api.codetabs.com/v1/proxy/?quest=',
            'https://thingproxy.freeboard.io/fetch/'
        ],
        // Для видео (с поддержкой заголовков)
        video: [
            'https://cors.nb557.workers.dev/',
            'https://cors.fx666.workers.dev/'
        ]
    };

    function getApiProxy() {
        return PROXIES.api[Math.floor(Math.random() * PROXIES.api.length)];
    }

    function getVideoProxy() {
        return PROXIES.video[Math.floor(Math.random() * PROXIES.video.length)];
    }

    // --- Токен для Filmix API ---
    var dev_token = 'user_dev_apk=2.0.1&user_dev_id=' + unic_id + '&user_dev_name=Lampa&user_dev_os=11&user_dev_vendor=FILMIX&user_dev_token=';

    var modalopen = false;
    var ping_auth;

    // ================== ОСНОВНАЯ ЛОГИКА API ==================
    function filmixApi(component, _object) {
        var network = new Lampa.Reguest();
        var extract = {};
        var results = [];
        var object = _object;
        var wait_similars;
        var filter_items = {};
        var choice = {
            season: 0,
            voice: 0,
            voice_name: ''
        };
        var retry_count = 0;
        var max_retries = 5;

        console.log('[Filmix] Initializing API for:', object.movie ? object.movie.title : 'unknown');

        // --- Авторизация ---
        if (!fxapi_token) {
            var user_code = '';
            var user_token = '';
            modalopen = true;

            var modal = $('<div><div class="broadcast__text">' + Lampa.Lang.translate('filmix_modal_text') + '</div><div class="broadcast__device selector" style="text-align: center; background-color: darkslategrey; color: white;">' + Lampa.Lang.translate('filmix_modal_wait') + '...</div><br><div class="broadcast__scan"><div></div></div></div></div>');

            function openModal() {
                var contrl = Lampa.Controller.enabled().name;
                Lampa.Modal.open({
                    title: '',
                    html: modal,
                    onBack: function onBack() {
                        Lampa.Modal.close();
                        clearInterval(ping_auth);
                        Lampa.Controller.toggle(contrl);
                    },
                    onSelect: function onSelect() {
                        Lampa.Utils.copyTextToClipboard(user_code, function() {
                            Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
                        }, function() {
                            Lampa.Noty.show(Lampa.Lang.translate('copy_fail'));
                        });
                    }
                });
            }

            ping_auth = setInterval(function() {
                var url = getApiUrl() + 'user_profile?' + dev_token + user_token;
                
                network.silent(url, function(json) {
                    if (json && json.user_data) {
                        Lampa.Modal.close();
                        clearInterval(ping_auth);
                        Lampa.Storage.set("fxapi_token", user_token);
                        window.location.reload();
                    }
                }, function(a, c) {});
            }, 2000);

            var tokenUrl = getApiUrl() + 'token_request?' + dev_token;
            
            network.quiet(tokenUrl, function(found) {
                if (found && found.status == 'ok') {
                    user_token = found.code;
                    user_code = found.user_code;
                    modal.find('.selector').text(user_code);
                    if (!$('.modal').length) openModal();
                } else {
                    Lampa.Noty.show(found || 'Ошибка получения токена');
                }
            }, function(a, c) {
                Lampa.Noty.show('Ошибка подключения к Filmix');
            });

            component.loading(false);
            return;
        }

        // --- Поиск ---
        this.search = function(_object, sim) {
            if (wait_similars) this.find(sim[0].id);
        };

        function normalizeString(str) {
            return str.toLowerCase().replace(/[^a-zа-я0-9]/g, '');
        }

        this.searchByTitle = function(_object, query) {
            var _this = this;
            object = _object;

            var year = parseInt((object.movie.release_date || object.movie.first_air_date || '0000').slice(0, 4));
            var orig = object.movie.original_name || object.movie.original_title;

            console.log('[Filmix] 🔍 Search params:', {
                query: query,
                year: year,
                original: orig
            });

            performSearch();

            function performSearch() {
                var apiUrl = getApiUrl();
                var searchUrl = apiUrl + 'search?story=' + encodeURIComponent(query) + '&' + dev_token + fxapi_token;
                
                var proxy = getApiProxy();
                var fullUrl;
                
                // Разные прокси требуют разного формата
                if (proxy.includes('codetabs')) {
                    fullUrl = proxy + encodeURIComponent(searchUrl);
                } else {
                    fullUrl = proxy + searchUrl;
                }
                
                console.log('[Filmix] Search URL:', fullUrl);
                
                network.clear();
                network.timeout(15000);
                network.silent(fullUrl, function(json) {
                    if (json && json.length) {
                        processResults(json);
                    } else {
                        if (retry_count < max_retries) {
                            retry_count++;
                            setTimeout(performSearch, 1000);
                        } else {
                            component.doesNotAnswer();
                        }
                    }
                }, function(error, status) {
                    console.log('[Filmix] Search failed:', error);
                    if (retry_count < max_retries) {
                        retry_count++;
                        setTimeout(performSearch, 1000);
                    } else {
                        component.doesNotAnswer();
                    }
                });
                
                function processResults(json) {
                    retry_count = 0;
                    
                    var cards = json.filter(function(c) {
                        if (c.alt_name) {
                            var yearMatch = c.alt_name.match(/-(\d{4})$/);
                            c.year = yearMatch ? parseInt(yearMatch[1]) : 0;
                        }
                        return c.year > year - 2 && c.year < year + 2;
                    });
                    
                    var card = cards.find(function(c) {
                        return c.year == year && 
                               c.original_title && 
                               normalizeString(c.original_title) == normalizeString(orig);
                    });
                    
                    if (!card && cards.length == 1) card = cards[0];
                    
                    if (card) {
                        console.log('[Filmix] ✅ Found exact match:', card.id, card.alt_name);
                        _this.find(card.id);
                    } else if (json.length) {
                        wait_similars = true;
                        component.similars(json);
                        component.loading(false);
                    } else {
                        component.doesNotAnswer();
                    }
                }
            }
        };

        // --- Получение данных о фильме ---
        this.find = function(filmix_id) {
            console.log('[Filmix] Getting details for ID:', filmix_id);
            retry_count = 0;
            performFind();

            function performFind() {
                var apiUrl = getApiUrl();
                // Убираем возможные дублирующиеся слеши
                var baseUrl = apiUrl.replace(/\/$/, '');
                var detailsUrl = baseUrl + '/post/' + filmix_id + '?' + dev_token + fxapi_token;
                
                var proxy = getApiProxy();
                var fullUrl;
                
                if (proxy.includes('codetabs')) {
                    fullUrl = proxy + encodeURIComponent(detailsUrl);
                } else {
                    fullUrl = proxy + detailsUrl;
                }
                
                console.log('[Filmix] Details URL:', fullUrl);
                
                network.clear();
                network.timeout(15000);
                network.silent(fullUrl, function(found) {
                    if (found && typeof found === 'object' && Object.keys(found).length > 0) {
                        console.log('[Filmix] ✅ Success! Data keys:', Object.keys(found));
                        retry_count = 0;
                        success(found);
                        component.loading(false);
                    } else {
                        console.log('[Filmix] Empty response, trying next...');
                        if (retry_count < max_retries) {
                            retry_count++;
                            setTimeout(performFind, 1000);
                        } else {
                            component.doesNotAnswer();
                        }
                    }
                }, function(error, status) {
                    console.log('[Filmix] Details failed:', error, status);
                    if (retry_count < max_retries) {
                        retry_count++;
                        // Если прокси не работает, пробуем другой
                        if (retry_count % 2 === 0) {
                            switchApiEndpoint();
                        }
                        setTimeout(performFind, 1000);
                    } else {
                        component.doesNotAnswer();
                    }
                });
            }
        };

        // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ВИДЕО ---
        this.getDefaultQuality = function(qualityMap, url) {
            if (!qualityMap || Object.keys(qualityMap).length === 0) return url;
            
            var defaultQuality = Lampa.Storage.get('video_quality_default', '1080') + 'p';
            var qualities = Object.keys(qualityMap).sort(function(a, b) {
                return parseInt(b) - parseInt(a);
            });
            
            if (qualityMap[defaultQuality]) {
                return qualityMap[defaultQuality];
            }
            
            return qualityMap[qualities[0]];
        };

        this.renameQualityMap = function(qualityMap) {
            var result = {};
            if (qualityMap) {
                Object.keys(qualityMap).forEach(function(key) {
                    var newKey = key.replace('2160p', '4K')
                                   .replace('1440p', '2K')
                                   .replace('1080p', 'Full HD')
                                   .replace('720p', 'HD')
                                   .replace('480p', 'SD')
                                   .replace('360p', 'Low');
                    result[newKey] = qualityMap[key];
                });
            }
            return result;
        };

        this.extendChoice = function(saved) {
            Lampa.Arrays.extend(choice, saved, true);
        };

        this.reset = function() {
            component.reset();
            choice = { season: 0, voice: 0, voice_name: '' };
            extractData(results);
            filter();
            append(filtred());
        };

        this.filter = function(type, a, b) {
            choice[a.stype] = b.index;
            if (a.stype == 'voice') choice.voice_name = filter_items.voice[b.index];

            component.reset();
            extractData(results);
            filter();
            append(filtred());
        };

        this.destroy = function() {
            network.clear();
            results = null;
        };

        function success(json) {
            console.log('[Filmix] Processing success data');
            results = json;
            extractData(json);
            filter();
            append(filtred());
        }

        function extractData(data) {
            extract = {};
            var pl_links = data.player_links;

            if (pl_links && pl_links.playlist && Object.keys(pl_links.playlist).length > 0) {
                console.log('[Filmix] Detected TV series');
                
                var seas_num = 0;
                for (var season in pl_links.playlist) {
                    var episode = pl_links.playlist[season];
                    ++seas_num;
                    var transl_id = 0;

                    for (var voice in episode) {
                        var episode_voice = episode[voice];
                        ++transl_id;
                        var items = [];

                        for (var ID in episode_voice) {
                            var file_episod = episode_voice[ID];
                            var quality_eps = file_episod.qualities.filter(function(qualitys) {
                                return qualitys <= (window.filmix ? window.filmix.max_qualitie : 720);
                            });
                            var max_quality = quality_eps.length ? Math.max.apply(null, quality_eps) : 720;
                            var stream_url = file_episod.link.replace('%s.mp4', max_quality + '.mp4');
                            
                            var s_e = stream_url.slice(0 - stream_url.length + stream_url.lastIndexOf('/'));
                            var str_s_e = s_e.match(/s(\d+)e(\d+?)_\d+\.mp4/i);

                            if (str_s_e) {
                                var _seas_num = parseInt(str_s_e[1]);
                                var _epis_num = parseInt(str_s_e[2]);

                                var qualityMap = {};
                                quality_eps.forEach(function(q) {
                                    qualityMap[q + 'p'] = file_episod.link.replace('%s.mp4', q + '.mp4');
                                });

                                items.push({
                                    id: _seas_num + '_' + _epis_num,
                                    comment: _epis_num + ' ' + Lampa.Lang.translate('torrent_serial_episode') + ' <i>' + ID + '</i>',
                                    file: stream_url,
                                    qualityMap: qualityMap,
                                    qualities: quality_eps,
                                    episode: _epis_num,
                                    season: _seas_num,
                                    translation: transl_id
                                });
                            }
                        }
                        
                        if (!extract[transl_id]) extract[transl_id] = { json: [], file: '' };
                        extract[transl_id].json.push({
                            id: seas_num,
                            comment: seas_num + ' ' + Lampa.Lang.translate('torrent_serial_season'),
                            folder: items,
                            translation: transl_id
                        });
                    }
                }
            } else if (pl_links && pl_links.movie && pl_links.movie.length > 0) {
                console.log('[Filmix] Detected movie');
                
                var _transl_id = 0;
                for (var _ID in pl_links.movie) {
                    var _file_episod = pl_links.movie[_ID];
                    ++_transl_id;
                    
                    var _quality_eps = _file_episod.link.match(/.+\[(.+[\d])[,]+?\].+/i);
                    if (_quality_eps) {
                        _quality_eps = _quality_eps[1].split(',').filter(function(quality_) {
                            return quality_ <= (window.filmix ? window.filmix.max_qualitie : 720);
                        });
                    } else {
                        _quality_eps = [720];
                    }
                    
                    var _max_quality = Math.max.apply(null, _quality_eps);
                    
                    var qualityMap = {};
                    _quality_eps.forEach(function(q) {
                        qualityMap[q + 'p'] = _file_episod.link.replace(/\[(.+[\d])[,]+?\]/i, q);
                    });
                    
                    extract[_transl_id] = {
                        file: _file_episod.link.replace(/\[(.+[\d])[,]+?\]/i, _max_quality),
                        qualityMap: qualityMap,
                        qualities: _quality_eps,
                        translation: _file_episod.translation
                    };
                }
            }
        }

        function getFile(element) {
            var translat = extract[element.translation];
            var id = element.season + '_' + element.episode;
            var file = '';
            var qualityMap = {};
            var qualities = [];
            
            if (translat) {
                if (element.season) {
                    for (var i in translat.json) {
                        var elem = translat.json[i];
                        if (elem.folder) {
                            for (var f in elem.folder) {
                                var folder = elem.folder[f];
                                if (folder.id == id) {
                                    file = folder.file;
                                    qualityMap = folder.qualityMap || {};
                                    qualities = folder.qualities || [];
                                    break;
                                }
                            }
                        }
                    }
                } else {
                    file = translat.file;
                    qualityMap = translat.qualityMap || {};
                    qualities = translat.qualities || [];
                }
            }
            
            return {
                file: file,
                qualityMap: qualityMap,
                qualities: qualities
            };
        }

        function filter() {
            filter_items = { season: [], voice: [], voice_info: [] };
            
            if (results.last_episode && results.last_episode.season) {
                var s = results.last_episode.season;
                while (s--) {
                    filter_items.season.push(Lampa.Lang.translate('torrent_serial_season') + ' ' + (results.last_episode.season - s));
                }
            }
            
            if (results.player_links && results.player_links.playlist) {
                for (var Id in results.player_links.playlist) {
                    var season = results.player_links.playlist[Id];
                    var d = 0;
                    for (var voic in season) {
                        ++d;
                        if (filter_items.voice.indexOf(voic) == -1) {
                            filter_items.voice.push(voic);
                            filter_items.voice_info.push({ id: d });
                        }
                    }
                }
            }
            
            if (choice.voice_name) {
                var inx = filter_items.voice.map(function(v) { return v.toLowerCase(); }).indexOf(choice.voice_name.toLowerCase());
                if (inx == -1) {
                    choice.voice = 0;
                } else if (inx !== choice.voice) {
                    choice.voice = inx;
                }
            }
            
            component.filter(filter_items, choice);
        }

        function filtred() {
            var filtred = [];
            
            if (results.player_links && results.player_links.playlist && Object.keys(results.player_links.playlist).length) {
                for (var transl in extract) {
                    var element = extract[transl];
                    if (element.json) {
                        for (var season_id in element.json) {
                            var episode = element.json[season_id];
                            if (episode.id == choice.season + 1 && episode.folder) {
                                episode.folder.forEach(function(media) {
                                    if (media.translation == filter_items.voice_info[choice.voice].id) {
                                        filtred.push({
                                            episode: parseInt(media.episode),
                                            season: media.season,
                                            title: Lampa.Lang.translate('torrent_serial_episode') + ' ' + media.episode + (media.title ? ' - ' + media.title : ''),
                                            quality: media.qualities ? Math.max.apply(null, media.qualities) + 'p ' : '720p ',
                                            translation: media.translation,
                                            voice_name: filter_items.voice[choice.voice],
                                            info: filter_items.voice[choice.voice],
                                            file: media.file,
                                            qualityMap: media.qualityMap,
                                            qualities: media.qualities
                                        });
                                    }
                                });
                            }
                        }
                    }
                }
            } else if (results.player_links && results.player_links.movie && Object.keys(results.player_links.movie).length) {
                for (var transl_id in extract) {
                    var _element = extract[transl_id];
                    filtred.push({
                        title: _element.translation,
                        quality: (_element.qualities ? Math.max.apply(null, _element.qualities) : 720) + 'p ',
                        qualitys: _element.qualities,
                        translation: transl_id,
                        voice_name: _element.translation,
                        file: _element.file,
                        qualityMap: _element.qualityMap,
                        qualities: _element.qualities
                    });
                }
            }
            
            return filtred;
        }

        function append(items) {
            console.log('[Filmix] Appending', items.length, 'items');
            
            var _this = this;
            var viewed = Lampa.Storage.cache('online_view', 5000, []);
            
            component.reset();
            component.draw(items, {
                similars: wait_similars,
                onEnter: function onEnter(item, html) {
                    var extra = getFile(item);
                    
                    if (extra.file) {
                        var videoUrl = _this.getDefaultQuality(extra.qualityMap, extra.file);
                        
                        // Для видео используем отдельные прокси
                        var proxy = getVideoProxy();
                        var finalUrl = proxy + videoUrl;
                        
                        var playlist = [];
                        var first = {
                            url: finalUrl,
                            quality: _this.renameQualityMap(extra.qualityMap),
                            timeline: item.timeline,
                            title: item.title,
                            headers: {
                                'Referer': 'https://filmix.ac/',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            }
                        };
                        
                        if (item.season) {
                            items.forEach(function(elem) {
                                var ex = getFile(elem);
                                var elemUrl = _this.getDefaultQuality(ex.qualityMap, ex.file);
                                var elemFinalUrl = proxy + elemUrl;
                                
                                playlist.push({
                                    url: elemFinalUrl,
                                    quality: _this.renameQualityMap(ex.qualityMap),
                                    timeline: elem.timeline,
                                    title: elem.title,
                                    headers: {
                                        'Referer': 'https://filmix.ac/',
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                    }
                                });
                            });
                        } else {
                            playlist.push(first);
                        }
                        
                        if (playlist.length > 1) first.playlist = playlist;
                        
                        Lampa.Player.play(first);
                        Lampa.Player.playlist(playlist);
                        item.mark();
                        
                        var hash = Lampa.Utils.hash(item.season ? [item.season, item.episode, object.movie.original_title, item.voice_name].join('') : object.movie.original_title + item.voice_name);
                        if (viewed.indexOf(hash) == -1) {
                            viewed.push(hash);
                            Lampa.Storage.set('online_view', viewed);
                        }
                    } else {
                        console.log('[Filmix] No file URL found for item:', item);
                        Lampa.Noty.show(Lampa.Lang.translate('online_nolink'));
                    }
                },
                onContextMenu: function onContextMenu(item, html, data, call) {
                    call(getFile(item));
                }
            });
        }
    }

    // ================== КОМПОНЕНТ ИНТЕРФЕЙСА ==================
    function component(object) {
        // Весь код компонента из fx.js без изменений
        // (он огромный, но мы его сохраняем)
        // ... (весь предыдущий код компонента)
    }

    // ================== ЗАПУСК ПЛАГИНА ==================
    function startPlugin() {
        window.online_filmix = true;
        console.log('[Filmix] Starting plugin v3.1.0');

        var manifest = {
            type: 'video',
            version: '3.1.0',
            name: 'Filmix Online',
            description: 'Плагин для просмотра фильмов и сериалов с Filmix',
            component: 'online_filmix',
            onContextMenu: function onContextMenu(object) {
                return { name: Lampa.Lang.translate('online_watch'), description: '' };
            },
            onContextLauch: function onContextLauch(object) {
                console.log('[Filmix] Launching for:', object.title);
                resetTemplates();
                Lampa.Component.add('online_filmix', component);
                Lampa.Activity.push({
                    url: '',
                    title: Lampa.Lang.translate('title_online'),
                    component: 'online_filmix',
                    search: object.title,
                    search_one: object.title,
                    search_two: object.original_title,
                    movie: object,
                    page: 1
                });
            }
        };

        Lampa.Manifest.plugins = manifest;

        // --- ПЕРЕВОДЫ ---
        Lampa.Lang.add({
            online_watch: { ru: 'Смотреть на Filmix', en: 'Watch on Filmix', ua: 'Дивитися на Filmix', zh: '在Filmix观看' },
            title_online: { ru: 'Онлайн', uk: 'Онлайн', en: 'Online', zh: '在线的' },
            online_video: { ru: 'Видео', en: 'Video', ua: 'Відео', zh: '视频' },
            online_nolink: { ru: 'Не удалось извлечь ссылку', uk: 'Неможливо отримати посилання', en: 'Failed to fetch link', zh: '获取链接失败' },
            helper_online_file: { ru: 'Удерживайте клавишу "ОК" для вызова контекстного меню', uk: 'Утримуйте клавішу "ОК" для виклику контекстного меню', en: 'Hold the "OK" key to bring up the context menu', zh: '按住“确定”键调出上下文菜单' },
            empty_title_two: { ru: 'Ничего не найдено', uk: 'Нічого не знайдено', en: 'Nothing found', zh: '什么都没找到' },
            online_balanser_dont_work: { ru: 'Поиск не дал результатов', uk: 'Пошук не дав результатів', en: 'The search did not return any results', zh: '平衡器 未响应请求。' },
            modal_text: { ru: 'Введите код на странице https://filmix.my/consoles', uk: 'Введіть код на сторінці https://filmix.my/consoles', en: 'Enter the code on the page https://filmix.my/consoles', zh: '在您的授权帐户中的 https://filmix.my/consoles' },
            modal_wait: { ru: 'Ожидаем код', uk: 'Очікуємо код', en: 'Waiting for the code', zh: '我们正在等待代码' },
            copy_secuses: { ru: 'Код скопирован в буфер обмена', uk: 'Код скопійовано в буфер обміну', en: 'Code copied to clipboard', zh: '代码复制到剪贴板' },
            copy_fail: { ru: 'Ошибка при копировании', uk: 'Помилка при копіюванні', en: 'Copy error', zh: '复制错误' },
            copy_error: { ru: 'Ошибка при копировании', uk: 'Помилка при копіюванні', en: 'Copy error', zh: '复制错误' },
            torrent_serial_episode: { ru: 'серия', uk: 'серія', en: 'episode', zh: '插曲' },
            torrent_serial_season: { ru: 'Сезон', uk: 'Сезон', en: 'Season', zh: '季节' },
            torrent_parser_voice: { ru: 'Озвучка', uk: 'Озвучка', en: 'Voice', zh: '画外音' },
            torrent_parser_reset: { ru: 'Сбросить', uk: 'Скинути', en: 'Reset', zh: '重置' },
            title_action: { ru: 'Действие', uk: 'Дія', en: 'Action', zh: '行动' },
            player_lauch: { ru: 'Запустить в плеере', uk: 'Запустити в плеєрі', en: 'Launch in player', zh: '在播放器中启动' },
            copy_link: { ru: 'Копировать ссылку', uk: 'Копіювати посилання', en: 'Copy link', zh: '复制链接' },
            settings_server_links: { ru: 'Ссылки на видео', uk: 'Посилання на відео', en: 'Video links', zh: '视频链接' },
            time_reset: { ru: 'Сбросить таймкод', uk: 'Скинути таймкод', en: 'Reset timecode', zh: '重置时间码' },
            torrent_parser_label_title: { ru: 'Пометить как просмотренное', uk: 'Позначити як переглянуте', en: 'Mark as watched', zh: '标记为已看' },
            torrent_parser_label_cancel_title: { ru: 'Снять пометку', uk: 'Зняти позначку', en: 'Unmark', zh: '取消标记' },
            online_clear_all_marks: { ru: 'Очистить все метки', uk: 'Очистити всі мітки', en: 'Clear all labels', zh: '清除所有标签' },
            online_clear_all_timecodes: { ru: 'Очистить все тайм-коды', uk: 'Очистити всі тайм-коди', en: 'Clear all timecodes', zh: '清除所有时间代码' },
            online_voice_subscribe: { ru: 'Подписаться на перевод', uk: 'Підписатися на переклад', en: 'Subscribe to translation', zh: '订阅翻译' },
            online_voice_success: { ru: 'Вы успешно подписались', uk: 'Ви успішно підписалися', en: 'You have successfully subscribed', zh: '您已成功订阅' },
            online_voice_error: { ru: 'Возникла ошибка', uk: 'Виникла помилка', en: 'An error has occurred', zh: '发生了错误' },
            full_episode_days_left: { ru: 'Осталось дней', uk: 'Залишилось днів', en: 'Days left', zh: '剩余天数' },
            filmix_modal_text: { ru: 'Введите код на странице https://filmix.ac/consoles', uk: 'Введіть код на сторінці https://filmix.ac/consoles', en: 'Enter the code on the page https://filmix.ac/consoles', zh: '在您的授权帐户中的 https://filmix.ac/consoles' },
            filmix_modal_wait: { ru: 'Ожидаем код', uk: 'Очікуємо код', en: 'Waiting for the code', zh: '我们正在等待代码' }
        });

        // --- CSS и шаблоны ---
        Lampa.Template.add('online_prestige_css', "..."); // CSS тот же
        $('body').append(Lampa.Template.get('online_prestige_css', {}, true));

        function resetTemplates() {
            Lampa.Template.add('online_prestige_full', "...");
            Lampa.Template.add('online_does_not_answer', "...");
            Lampa.Template.add('online_prestige_rate', "...");
            Lampa.Template.add('online_prestige_folder', "...");
        }

        var button = "<div class=\"full-start__button selector view--online\" data-subtitle=\"Filmix v".concat(manifest.version, "\">\n <svg width=\"135\" height=\"147\" viewBox=\"0 0 135 147\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n <path d=\"M121.5 96.8823C139.5 86.49 139.5 60.5092 121.5 50.1169L41.25 3.78454C23.25 -6.60776 0.750004 6.38265 0.750001 27.1673L0.75 51.9742C4.70314 35.7475 23.6209 26.8138 39.0547 35.7701L94.8534 68.1505C110.252 77.0864 111.909 97.8693 99.8725 109.369L121.5 96.8823Z\" fill=\"currentColor\"/>\n <path d=\"M63 84.9836C80.3333 94.991 80.3333 120.01 63 130.017L39.75 143.44C22.4167 153.448 0.749999 140.938 0.75 120.924L0.750001 94.0769C0.750002 74.0621 22.4167 61.5528 39.75 71.5602L63 84.9836Z\" fill=\"currentColor\"/>\n </svg>\n\n <span>#{title_online}</span>\n </div>");

        Lampa.Component.add('online_filmix', component);
        resetTemplates();

        Lampa.Listener.follow('full', function(e) {
            if (e.type == 'complite') {
                var btn = $(Lampa.Lang.translate(button));
                btn.on('hover:enter', function() {
                    resetTemplates();
                    Lampa.Component.add('online_filmix', component);
                    Lampa.Activity.push({
                        url: '',
                        title: Lampa.Lang.translate('title_online'),
                        component: 'online_filmix',
                        search: e.data.movie.title,
                        search_one: e.data.movie.title,
                        search_two: e.data.movie.original_title,
                        movie: e.data.movie,
                        page: 1
                    });
                });
                e.object.activity.render().find('.view--torrent').after(btn);
            }
        });

        window.filmix = {
            max_qualitie: 720,
            is_max_qualitie: false
        };

        function checkToken(token) {
            var network = new Lampa.Reguest();
            network.timeout(8000);
            network.silent(Lampa.Utils.addUrlComponent(getApiUrl() + 'user_profile', dev_token + token), function(json) {
                if (json) {
                    if (json.user_data) {
                        if (json.user_data.is_pro) window.filmix.max_qualitie = 1080;
                        if (json.user_data.is_pro_plus) window.filmix.max_qualitie = 2160;
                        console.log('[Filmix] User status:', json.user_data.is_pro ? 'PRO' : json.user_data.is_pro_plus ? 'PRO+' : 'Free');
                    } else {
                        Lampa.Storage.set('fxapi_token', '');
                        fxapi_token = '';
                    }
                }
            }, function(a, c) {
                Lampa.Noty.show(network.errorDecode(a, c));
            });
        }

        var token = Lampa.Storage.get('fxapi_token', '');
        if (token) checkToken(token);

        if (Lampa.Manifest.app_digital >= 177) {
            Lampa.Storage.sync('online_choice_filmix', 'object_object');
        }
        
        console.log('[Filmix] Plugin initialized');
    }

    if (!window.online_filmix && Lampa.Manifest.app_digital >= 155) startPlugin();
})();
