angular.module('container', [])
.controller('ContainerController', ['$scope', '$sce', '$routeParams', '$location', 'Container', 'ContainerCommit', 'Image', 'Messages', 'ViewSpinner', '$timeout',
    function ($scope, $sce, $routeParams, $location, Container, ContainerCommit, Image, Messages, ViewSpinner, $timeout) {
        $scope.changes = [];
        $scope.editEnv = false;
        $scope.editPorts = false;
        $scope.editBinds = false;
        $scope.saveInst = false;
        $scope.fm_addr = "";
        $scope.newCfg = {
            Env: [],
            Ports: {}
        };
        window.test_scope = $scope
        var update = function () {
            ViewSpinner.spin();
            Container.get({id: $routeParams.id}, function (d) {
                $scope.container = d;
                $scope.container.edit = false;
                $scope.container.newContainerName = d.Name;

                // fill up env
                if (d.Config.Env) {
                    $scope.newCfg.Env = d.Config.Env.map(function (entry) {
                        return {name: entry.split('=')[0], value: entry.split('=')[1]};
                    });
                }

                // fill up ports
                $scope.newCfg.Ports = {};
                angular.forEach(d.Config.ExposedPorts, function(i, port) {
                    if (d.HostConfig.PortBindings && port in d.HostConfig.PortBindings) {
                        $scope.newCfg.Ports[port] = d.HostConfig.PortBindings[port];
                    }
                    else {
                        $scope.newCfg.Ports[port] = [];
                    }
                });

                // fill up bindings
                $scope.newCfg.Binds = [];
                var defaultBinds = {};
                angular.forEach(d.Config.Volumes, function(value, vol) {
                    defaultBinds[vol] = { ContPath: vol, HostPath: '', ReadOnly: false, DefaultBind: true };
                });
                angular.forEach(d.HostConfig.Binds, function(binding, i) {
                    var mountpoint = binding.split(':')[0];
                    var vol = binding.split(':')[1] || '';
                    var ro = binding.split(':').length > 2 && binding.split(':')[2] === 'ro';
                    var defaultBind = false;
                    if (vol === '') {
                        vol = mountpoint;
                        mountpoint = '';
                    }

                    if (vol in defaultBinds) {
                        delete defaultBinds[vol];
                        defaultBind = true;
                    }
                    $scope.newCfg.Binds.push({ ContPath: vol, HostPath: mountpoint, ReadOnly: ro, DefaultBind: defaultBind });
                });
                angular.forEach(defaultBinds, function(bind) {
                    $scope.newCfg.Binds.push(bind);
                });

                ViewSpinner.stop();
            }, function (e) {
                if (e.status === 404) {
                    $('.detail').hide();
                    Messages.error("Not found", "Pipeline not found.");
                } else {
                    Messages.error("Failure", e.data);
                }
                ViewSpinner.stop();
            });

        };

        var display_galaxy_init = function () {
            console.log("galaxy init msg");
            $("#galaxy_server_ip").hide();
            $("#galaxy_server_info").append("<li id='galaxy_init_msg_wrapper'><span id='galaxy_init_msg' style='text-align:center'>Initializing the Galaxy server..<br />Please stand by..</span></li>");

            function blinker() {
                $("#galaxy_init_msg").fadeOut(700);
                $("#galaxy_init_msg").fadeIn(700);
            }
            var msg_interval = setInterval(blinker,1400);

            setTimeout(function() {
                clearInterval(msg_interval);
                $("#galaxy_init_msg_wrapper").remove();
                $("#galaxy_server_ip").fadeIn();
            }, 22000);
        }

        $scope.hostIpAddress = window.location.hostname;
        var fmUrl = 'http://' + window.location.hostname + ':9090';
        $scope.fm_addr = $sce.trustAsResourceUrl(fmUrl);

        $scope.checkPortInputLength = function ($event, value, maxLength) {
            if (value != undefined && value.toString().length >= maxLength) {
                //$event.preventDefault();
                value.splice(0,4);
            }
        }        
        $scope.start = function () {
            ViewSpinner.spin();
            Container.start({
                id: $scope.container.Id
            }, {}, function (d) {
                display_galaxy_init();
                update();
                Messages.send("Pipeline started", $routeParams.id);
                // setTimeout(function(){
                //     console.log("updated!");
                //     if($scope.container.State.Running) {
                //         $("#rename_btn").click();
                //         $scope.edit = true;
                //         $("#options_input").click();
                //         $scope.editEnv = true
                //     }
                // },10000)
            }, function (e) {
                update();
                Messages.error("Failure", "Pipeline failed to start." + e.data);
            });
        };

        $scope.stop = function () {
            var user_confirm = confirm("The pipeline will be stopped!\nContinue?");
            if (user_confirm) {
                ViewSpinner.spin();
                Container.stop({id: $routeParams.id}, function (d) {
                    update();
                    Messages.send("Pipeline stopped", $routeParams.id);
                }, function (e) {
                    update();
                    Messages.error("Failure", "Pipeline failed to stop." + e.data);
                });
            }
        };

        $scope.kill = function () {
            var user_confirm = confirm("The pipeline will be stopped and discarded data!\nContinue?");
            if (user_confirm) {
                ViewSpinner.spin();
                Container.kill({id: $routeParams.id}, function (d) {
                    update();
                    Messages.send("Pipeline killed", $routeParams.id);
                }, function (e) {
                    update();
                    Messages.error("Failure", "Pipeline failed to die." + e.data);
                });
            }
        };

        $scope.restartEnv = function () {
            console.log("restart")
            var config = angular.copy($scope.container.Config);

            config.Env = $scope.newCfg.Env.map(function(entry) {
                return entry.name+"="+entry.value;
            });

            var portBindings = angular.copy($scope.newCfg.Ports);
            angular.forEach(portBindings, function(item, key) {
                if (item.length === 0) {
                    delete portBindings[key];
                }
            });


            var binds = [];
            angular.forEach($scope.newCfg.Binds, function(b) {
                if (b.ContPath !== '') {
                    var bindLine = '';
                    if (b.HostPath !== '') {
                        bindLine = b.HostPath + ':';
                    }
                    bindLine += b.ContPath;
                    if (b.ReadOnly) {
                        bindLine += ':ro';
                    }
                    if (b.HostPath !== '' || !b.DefaultBind) {
                        binds.push(bindLine);
                    }
                }
            });


            ViewSpinner.spin();
            ContainerCommit.commit({id: $routeParams.id, tag: $scope.container.Config.Image, config: config }, function (d) {
                if ('Id' in d) {
                    var imageId = d.Id;
                    Image.inspect({id: imageId}, function(imageData) {
                        // Append current host config to image with new port bindings
                        window.test_imageData = imageData;
                        imageData.Config.HostConfig = angular.copy($scope.container.HostConfig);
                        imageData.Config.HostConfig.PortBindings = portBindings;
                        imageData.Config.HostConfig.Binds = binds;
                        if (imageData.Config.HostConfig.NetworkMode === 'host') {
                            imageData.Config.Hostname = '';
                        }

                        Container.create(imageData.Config, function(containerData) {
                            if (!('Id' in containerData)) {
                                Messages.error("Failure", "Pipeline failed to create.");
                                return;
                            }
                            // Stop current if running
                            if ($scope.container.State.Running) {
                                Container.stop({id: $routeParams.id}, function (d) {
                                    Messages.send("Pipeline stopped", $routeParams.id);
                                    // start new
                                    Container.start({
                                        id: containerData.Id
                                    }, function (d) {
                                        $location.url('/containers/' + containerData.Id + '/');

                                        Container.rename({id: containerData.Id, 'name': $scope.container.newContainerName}, function (d) {
                                          if (d.message) {
                                            $scope.container.newContainerName = $scope.container.Name;
                                            Messages.error("Unable to rename", "The name may already exists");
                                          } else {
                                            $scope.container.Name = $scope.container.newContainerName;
                                            Messages.send("Container successfully renamed", d.name);
                                          }
                                        }, function (e) {
                                          Messages.error("Failure", e, "Pipeline failed to rename\nThe name may already exists.");
                                        });

                                        Messages.send("Pipeline started", $routeParams.id);
                                    }, function (e) {
                                        update();
                                        Messages.error("Failure", "Pipeline failed to start." + e.data);
                                    });
                                }, function (e) {
                                    update();
                                    Messages.error("Failure", "Pipeline failed to stop." + e.data);
                                });
                            } else {
                                // start new
                                Container.start({
                                    id: containerData.Id
                                }, function (d) {
                                    $location.url('/containers/'+containerData.Id+'/');

                                    Container.rename({id: containerData.Id, 'name': $scope.container.newContainerName}, function (d) {
                                      if (d.message) {
                                        $scope.container.newContainerName = $scope.container.Name;
                                        Messages.error("Unable to rename", "The name may already exists");
                                      } else {
                                        $scope.container.Name = $scope.container.newContainerName;
                                        Messages.send("Container successfully renamed", d.name);
                                      }
                                    }, function (e) {
                                      Messages.error("Failure", e, "Pipeline failed to rename\nThe name may already exists.");
                                    });

                                    Messages.send("Pipeline started", $routeParams.id);
                                }, function (e) {
                                    update();
                                    Messages.error("Failure", "Pipeline failed to start." + e.data);
                                });
                            }

                        }, function(e) {
                            update();
                            Messages.error("Failure", "Image failed to get." + e.data);
                        });
                    }, function (e) {
                        update();
                        Messages.error("Failure", "Image failed to get." + e.data);
                    });

                } else {
                    update();
                    Messages.error("Failure", "Pipeline commit failed.");
                }


            }, function (e) {
                update();
                Messages.error("Failure", "Pipeline failed to commit." + e.data);
            });
        };

        $scope.commit = function () {
            ViewSpinner.spin();
            ContainerCommit.commit({id: $routeParams.id, repo: $scope.container.Config.Image}, function (d) {
                update();
                Messages.send("Pipeline commited", $routeParams.id);
            }, function (e) {
                update();
                Messages.error("Failure", "Pipeline failed to commit." + e.data);
            });
        };
        $scope.pause = function () {
            ViewSpinner.spin();
            Container.pause({id: $routeParams.id}, function (d) {
                update();
                Messages.send("Pipeline paused", $routeParams.id);
            }, function (e) {
                update();
                Messages.error("Failure", "Pipeline failed to pause." + e.data);
            });
        };

        $scope.unpause = function () {
            ViewSpinner.spin();
            Container.unpause({id: $routeParams.id}, function (d) {
                update();
                Messages.send("Pipeline unpaused", $routeParams.id);
            }, function (e) {
                update();
                Messages.error("Failure", "Pipeline failed to unpause." + e.data);
            });
        };

        $scope.remove = function () {
            var user_confirm = confirm("This pipeline instance will be removed!\nContinue?");
            if (user_confirm) {
              ViewSpinner.spin();
              Container.remove({id: $routeParams.id}, function (d) {
                  update();
                  $location.path('/#');
                  Messages.send("Pipeline removed", $routeParams.id);
              }, function (e) {
                  update();
                  Messages.error("Failure", "Pipeline failed to remove." + e.data);
              });
            }
            else {
                var currAbsUrl = $location.absUrl();
                var redirectUrl = currAbsUrl.substring(0,currAbsUrl.lastIndexOf('delete'));
                $location.path(redirectUrl);
            }
        };

        $scope.restart = function () {
            ViewSpinner.spin();
            Container.restart({id: $routeParams.id}, function (d) {
                update();
                Messages.send("Pipeline restarted", $routeParams.id);
            }, function (e) {
                update();
                Messages.error("Failure", "Pipeline failed to restart." + e.data);
            });
        };

        $scope.hasContent = function (data) {
            return data !== null && data !== undefined;
        };

        $scope.getChanges = function () {
            ViewSpinner.spin();
            Container.changes({id: $routeParams.id}, function (d) {
                $scope.changes = d;
                ViewSpinner.stop();
            });
        };

        $scope.renameContainer = function () {
          Container.rename({id: $routeParams.id, 'name': $scope.container.newContainerName}, function (d) {
            if (d.message) {
              $scope.container.newContainerName = $scope.container.Name;
              Messages.error("Unable to rename", "The name may already exists");
            } else {
              $scope.container.Name = $scope.container.newContainerName;
              Messages.send("Container successfully renamed", d.name);
            }
          }, function (e) {
            Messages.error("Failure", e, "Pipeline failed to rename\nThe name may already exists.");
          });
          $scope.container.edit = false;

            // // #FIXME fix me later to handle http status to show the correct error message
            // Container.rename({id: $routeParams.id, 'name': $scope.container.newContainerName}, function (data) {
            //     if (data.name) {
            //         $scope.container.Name = data.name;
            //         Messages.send("Pipeline renamed", $routeParams.id);
            //     } else {
            //         $scope.container.newContainerName = $scope.container.Name;
            //         Messages.error("Failure", "Pipeline failed to rename\nThe name may already exists.");
            //     }
            // });
            // $scope.container.edit = false;
        };

        $scope.addEntry = function (array, entry) {
            array.push(entry);
        };
        $scope.rmEntry = function (array, entry) {
            var idx = array.indexOf(entry);
            array.splice(idx, 1);
        };

        $scope.toggleEdit = function() {
            $scope.edit = !$scope.edit;
        };

        $scope.cancel = function() {
            $scope.editEnv = false;
            $scope.getBowtieOpt = false;
        }

        $scope.openEdit = function() {
            $("#rename_btn").click();
            $scope.edit = true;
            $("#options_input").click();
            $scope.editEnv = true
        }

        update();
        $scope.getChanges();
        setTimeout(function(){
            try{
                var tagName = document.getElementById('base_name').innerHTML.split('/')[1].replace(/ /g,'');
                var tagName = tagName.split('\n')[0];
                if (tagName == "RNA_Seq_paired-end" || tagName == "ChIP_Seq_single-end" || tagName == "ChIP_Seq_paired-end") {
                    $("#rename_btn").click();
                    $scope.edit = true;
                    $("#options_input").click();
                    $scope.editEnv = true;
                    $("#hostIp_input").val(window.location.hostname);
                }
            }catch(e){
                //console.log(e)
            }
        },45)
    }]);
