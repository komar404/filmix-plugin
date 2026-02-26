(function() {
    'use strict';
    
    // Токен авторизации Filmix
    var fxapi_token = Lampa.Storage.get('fxapi_token', '');
    var unic_id = Lampa.Storage.get('fxapi_uid', '');
    
    if (!unic_id) {
        unic_id = Lampa.Utils.uid(16);
        Lampa.Storage.set('fxapi_uid', unic_id);
    }
    
    // Настройки API - БЕЗ ПРОКСИ
    var api_url = 'http://filmixapp.vip/api/v2/'; // Основной домен Filmix
    var dev_token = 'user_dev_apk=2.0.1&user_dev_id=' + unic_id + '&user_dev_name=Lampa&user_dev_os=11&user_dev_vendor=FILMIX&user_dev_token=';
    
    // Альтернативные домены на случай блокировки основного
    var mirror_domains = [
        'https://filmix.ac',
        'https://filmix.vip',
        'https://filmix.my',
        'https://filmix.la',
        'https://filmix.co'
    ];
    
    var current_domain_index = 0;
    var modalopen = false;
    var ping_auth;
    
    // Функция для получения текущего API URL с учетом зеркал
    function getApiUrl() {
        return mirror_domains[current_domain_index] + '/api/v2/';
    }
    
    // Функция для переключения на следующее зеркало при ошибке
    function switchMirror() {
        current_domain_index = (current_domain_index + 1) % mirror_domains.length;
        api_url = getApiUrl();
        console.log('Switching to mirror: ' + api_url);
        return api_url;
    }
    
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
        var max_retries = mirror_domains.length;
        
        // Авторизация через Filmix
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
                network.silent(Lampa.Utils.addUrlComponent(getApiUrl() + 'user_profile', dev_token + user_token), function(json) {
                    if (json && json.user_data) {
                        Lampa.Modal.close();
                        clearInterval(ping_auth);
                        Lampa.Storage.set("fxapi_token", user_token);
                        window.location.reload();
                    }
                }, function(a, c) {});
            }, 2000);
            
            network.quiet(Lampa.Utils.addUrlComponent(getApiUrl() + 'token_request', dev_token), function(found) {
                if (found.status == 'ok') {
                    user_token = found.code;
                    user_code = found.user_code;
                    modal.find('.selector').text(user_code);
                    
                    if (!$('.modal').length) openModal();
                } else {
                    Lampa.Noty.show(found);
                }
            }, function(a, c) {
                Lampa.Noty.show(network.errorDecode(a, c));
            });
            
            component.loading(false);
            return;
        }
        
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
            
            performSearch();
            
            function performSearch() {
                var url = getApiUrl() + 'search';
                url = Lampa.Utils.addUrlComponent(url, 'story=' + encodeURIComponent(query));
                url = Lampa.Utils.addUrlComponent(url, dev_token + fxapi_token);
                
                network.clear();
                network.silent(url, function(json) {
                    // Сброс счетчика попыток при успехе
                    retry_count = 0;
                    
                    var cards = json.filter(function(c) {
                        c.year = parseInt(c.alt_name.split('-').pop());
                        return c.year > year - 2 && c.year < year + 2;
                    });
                    
                    var card = cards.find(function(c) {
                        return c.year == year && normalizeString(c.original_title) == normalizeString(orig);
                    });
                    
                    if (!card && cards.length == 1) card = cards[0];
                    
                    if (card) {
                        _this.find(card.id);
                    } else if (json.length) {
                        wait_similars = true;
                        component.similars(json);
                        component.loading(false);
                    } else {
                        component.doesNotAnswer();
                    }
                }, function(a, c) {
                    // Обработка ошибки с переключением зеркала
                    if (retry_count < max_retries) {
                        retry_count++;
                        switchMirror();
                        performSearch();
                    } else {
                        component.doesNotAnswer();
                    }
                });
            }
        };
        
        this.find = function(filmix_id) {
            end_search(filmix_id);
            
            function end_search(filmix_id) {
                retry_count = 0;
                performFind();
                
                function performFind() {
                    network.clear();
                    network.timeout(10000);
                    network.silent(getApiUrl() + 'post/' + filmix_id + '?' + dev_token + fxapi_token, function(found) {
                        // Сброс счетчика попыток при успехе
                        retry_count = 0;
                        
                        if (found && Object.keys(found).length) {
                            success(found);
                            component.loading(false);
                        } else {
                            component.doesNotAnswer();
                        }
                    }, function(a, c) {
                        // Обработка ошибки с переключением зеркала
                        if (retry_count < max_retries) {
                            retry_count++;
                            switchMirror();
                            performFind();
                        } else {
                            component.doesNotAnswer();
                        }
                    });
                }
            }
        };
        
        this.extendChoice = function(saved) {
            Lampa.Arrays.extend(choice, saved, true);
        };
        
        this.reset = function() {
            component.reset();
            choice = {
                season: 0,
                voice: 0,
                voice_name: ''
            };
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
            results = json;
            extractData(json);
            filter();
            append(filtred());
        }
        
        function extractData(data) {
            extract = {};
            var pl_links = data.player_links;
            
            if (pl_links.playlist && Object.keys(pl_links.playlist).length > 0) {
                // Обработка сериалов
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
                                return qualitys <= window.filmix.max_qualitie;
                            });
                            
                            var max_quality = Math.max.apply(null, quality_eps);
                            var stream_url = file_episod.link.replace('%s.mp4', max_quality + '.mp4');
                            
                            var s_e = stream_url.slice(0 - stream_url.length + stream_url.lastIndexOf('/'));
                            var str_s_e = s_e.match(/s(\d+)e(\d+?)_\d+\.mp4/i);
                            
                            if (str_s_e) {
                                var _seas_num = parseInt(str_s_e[1]);
                                var _epis_num = parseInt(str_s_e[2]);
                                
                                items.push({
                                    id: _seas_num + '_' + _epis_num,
                                    comment: _epis_num + ' ' + Lampa.Lang.translate('torrent_serial_episode') + ' <i>' + ID + '</i>',
                                    file: stream_url,
                                    episode: _epis_num,
                                    season: _seas_num,
                                    quality: max_quality,
                                    qualities: quality_eps,
                                    translation: transl_id
                                });
                            }
                        }
                        
                        if (!extract[transl_id]) extract[transl_id] = {
                            json: [],
                            file: ''
                        };
                        
                        extract[transl_id].json.push({
                            id: seas_num,
                            comment: seas_num + ' ' + Lampa.Lang.translate('torrent_serial_season'),
                            folder: items,
                            translation: transl_id
                        });
                    }
                }
            } else if (pl_links.movie && pl_links.movie.length > 0) {
                // Обработка фильмов
                var _transl_id = 0;
                for (var _ID in pl_links.movie) {
                    var _file_episod = pl_links.movie[_ID];
                    ++_transl_id;
                    
                    var _quality_eps = _file_episod.link.match(/.+\[(.+[\d])[,]+?\].+/i);
                    if (_quality_eps) {
                        _quality_eps = _quality_eps[1].split(',').filter(function(quality_) {
                            return quality_ <= window.filmix.max_qualitie;
                        });
                    }
                    
                    var _max_quality = Math.max.apply(null, _quality_eps);
                    var file_url = _file_episod.link.replace(/\[(.+[\d])[,]+?\]/i, _max_quality);
                    
                    extract[_transl_id] = {
                        file: file_url,
                        translation: _file_episod.translation,
                        quality: _max_quality,
                        qualities: _quality_eps
                    };
                }
            }
        }
        
        function getFile(element, max_quality) {
            var translat = extract[element.translation];
            var id = element.season + '_' + element.episode;
            var file = '';
            var quality = false;
            
            if (translat) {
                if (element.season) {
                    for (var i in translat.json) {
                        var elem = translat.json[i];
                        if (elem.folder) {
                            for (var f in elem.folder) {
                                var folder = elem.folder[f];
                                if (folder.id == id) {
                                    file = folder.file;
                                    break;
                                }
                            }
                        } else {
                            if (elem.id == id) {
                                file = elem.file;
                                break;
                            }
                        }
                    }
                } else {
                    file = translat.file;
                }
            }
            
            max_quality = parseInt(max_quality);
            
            if (file) {
                var link = file.slice(0, file.lastIndexOf('_')) + '_';
                var orin = file.split('?');
                orin = orin.length > 1 ? '?' + orin.slice(1).join('?') : '';
                
                if (file.split('_').pop().replace('.mp4', '') !== max_quality) {
                    file = link + max_quality + '.mp4' + orin;
                }
                
                quality = {};
                var mass = [2160, 1440, 1080, 720, 480, 360];
                mass = mass.slice(mass.indexOf(max_quality));
                
                mass.forEach(function(n) {
                    quality[n + 'p'] = link + n + '.mp4' + orin;
                });
                
                var preferably = Lampa.Storage.get('video_quality_default', '1080') + 'p';
                if (quality[preferably]) file = quality[preferably];
            }
            
            return {
                file: file,
                quality: quality
            };
        }
        
        function filter() {
            filter_items = {
                season: [],
                voice: [],
                voice_info: []
            };
            
            if (results.last_episode && results.last_episode.season) {
                var s = results.last_episode.season;
                while (s--) {
                    filter_items.season.push(Lampa.Lang.translate('torrent_serial_season') + ' ' + (results.last_episode.season - s));
                }
            }
            
            for (var Id in results.player_links.playlist) {
                var season = results.player_links.playlist[Id];
                var d = 0;
                for (var voic in season) {
                    ++d;
                    if (filter_items.voice.indexOf(voic) == -1) {
                        filter_items.voice.push(voic);
                        filter_items.voice_info.push({
                            id: d
                        });
                    }
                }
            }
            
            if (choice.voice_name) {
                var inx = filter_items.voice.map(function(v) {
                    return v.toLowerCase();
                }).indexOf(choice.voice_name.toLowerCase());
                
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
            
            if (Object.keys(results.player_links.playlist).length) {
                for (var transl in extract) {
                    var element = extract[transl];
                    for (var season_id in element.json) {
                        var episode = element.json[season_id];
                        if (episode.id == choice.season + 1) {
                            episode.folder.forEach(function(media) {
                                if (media.translation == filter_items.voice_info[choice.voice].id) {
                                    filtred.push({
                                        episode: parseInt(media.episode),
                                        season: media.season,
                                        title: Lampa.Lang.translate('torrent_serial_episode') + ' ' + media.episode + (media.title ? ' - ' + media.title : ''),
                                        quality: media.quality + 'p ',
                                        translation: media.translation,
                                        voice_name: filter_items.voice[choice.voice],
                                        info: filter_items.voice[choice.voice]
                                    });
                                }
                            });
                        }
                    }
                }
            } else if (Object.keys(results.player_links.movie).length) {
                for (var transl_id in extract) {
                    var _element = extract[transl_id];
                    filtred.push({
                        title: _element.translation,
                        quality: _element.quality + 'p ',
                        qualitys: _element.qualities,
                        translation: transl_id,
                        voice_name: _element.translation
                    });
                }
            }
            
            return filtred;
        }
        
        function toPlayElement(element) {
            var extra = getFile(element, element.quality);
            var play = {
                title: element.title,
                url: extra.file,
                quality: extra.quality,
                timeline: element.timeline,
                callback: element.mark
            };
            return play;
        }
        
        function append(items) {
            component.reset();
            component.draw(items, {
                similars: wait_similars,
                onEnter: function onEnter(item, html) {
                    var extra = getFile(item, item.quality);
                    if (extra.file) {
                        var playlist = [];
                        var first = toPlayElement(item);
                        
                        if (item.season) {
                            items.forEach(function(elem) {
                                playlist.push(toPlayElement(elem));
                            });
                        } else {
                            playlist.push(first);
                        }
                        
                        if (playlist.length > 1) first.playlist = playlist;
                        
                        Lampa.Player.play(first);
                        Lampa.Player.playlist(playlist);
                        item.mark();
                    } else {
                        Lampa.Noty.show(Lampa.Lang.translate('online_nolink'));
                    }
                },
                onContextMenu: function onContextMenu(item, html, data, call) {
                    call(getFile(item, item.quality));
                }
            });
        }
    }
    
    function component(object) {
        // ... (весь остальной код component остается без изменений)
        // Код функции component полностью идентичен предыдущей версии
        // Я не стал его дублировать здесь для экономии места,
        // но в финальном файле он должен быть полностью скопирован из предыдущей версии
    }
    
    function startPlugin() {
        window.online_filmix = true;
        
        var manifest = {
            type: 'video',
            version: '1.1.0', // Повысил версию
            name: 'Filmix Online (без прокси)',
            description: 'Плагин для просмотра фильмов и сериалов с Filmix (прямые запросы)',
            component: 'online_filmix',
            onContextMenu: function onContextMenu(object) {
                return {
                    name: Lampa.Lang.translate('online_watch'),
                    description: ''
                };
            },
            onContextLauch: function onContextLauch(object) {
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
        
        // Добавляем переводы
        Lampa.Lang.add({
            online_watch: {
                ru: 'Смотреть на Filmix',
                en: 'Watch on Filmix',
                ua: 'Дивитися на Filmix',
                zh: '在Filmix观看'
            },
            filmix_modal_text: {
                ru: 'Введите код на странице https://filmix.ac/consoles',
                uk: 'Введіть код на сторінці https://filmix.ac/consoles',
                en: 'Enter the code on the page https://filmix.ac/consoles',
                zh: '在您的授权帐户中的 https://filmix.ac/consoles'
            },
            filmix_modal_wait: {
                ru: 'Ожидаем код',
                uk: 'Очікуємо код',
                en: 'Waiting for the code',
                zh: '我们正在等待代码'
            }
        });
        
        // Добавляем CSS
        Lampa.Template.add('online_prestige_css', "..."); // CSS тот же
        
        $('body').append(Lampa.Template.get('online_prestige_css', {}, true));
        
        function resetTemplates() {
            Lampa.Template.add('online_prestige_full', "..."); // Шаблоны те же
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
    }
    
    if (!window.online_filmix && Lampa.Manifest.app_digital >= 155) startPlugin();
})();
